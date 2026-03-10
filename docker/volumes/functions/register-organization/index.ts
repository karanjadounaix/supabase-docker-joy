import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
    // Handle CORS preflight
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders })
    }

    try {
        console.log("Function invoked: register-organization");

        const supabaseUrl = Deno.env.get('SUPABASE_URL')
        const supabaseServiceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

        console.log("Checking env vars:", {
            hasUrl: !!supabaseUrl,
            hasServiceKey: !!supabaseServiceRoleKey
        });

        if (!supabaseUrl || !supabaseServiceRoleKey) {
            throw new Error('Missing environment variables: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
        }

        const supabase = createClient(supabaseUrl, supabaseServiceRoleKey)

        // Parse request body
        let body;
        try {
            body = await req.json()
            console.log("Request body received:", JSON.stringify(body));
        } catch (e) {
            console.error("Failed to parse JSON body:", e);
            throw new Error("Invalid JSON body");
        }

        const { full_name, organization_name, domain, email, user_id, deferred } = body;

        // Detailed validation logging
        if (!email || !user_id) {
            const missing = [];
            if (!email) missing.push("email");
            if (!user_id) missing.push("user_id");
            const errorMsg = `Missing required fields: ${missing.join(", ")}`;
            console.error(errorMsg);
            throw new Error(errorMsg)
        }

        console.log(`Processing registration for: ${email} (user_id: ${user_id}, deferred: ${deferred})`);

        // 1. Create or Find Organization
        let orgId: string

        console.log(`Checking organization domain: ${domain}`);
        // Check if organization exists by domain
        const { data: existingOrg, error: findOrgError } = await supabase
            .from('organizations')
            .select('id')
            .eq('domain', domain)
            .maybeSingle()

        if (findOrgError) {
            console.error("Error finding organization:", findOrgError);
        }

        if (existingOrg) {
            console.log(`Organization found: ${existingOrg.id}`);
            orgId = existingOrg.id
        } else {
            console.log(`Creating new organization: ${organization_name}`);
            // Create new organization
            const { data: newOrg, error: orgError } = await supabase
                .from('organizations')
                .insert({
                    name: organization_name,
                    domain: domain,
                })
                .select()
                .single()

            if (orgError) {
                console.error('Error creating organization:', orgError)
                throw new Error('Failed to create organization: ' + orgError.message)
            }
            orgId = newOrg.id
            console.log(`Organization created: ${orgId}`);
        }

        // 2. Create or Update User in public.users
        // Check if user exists by email OR user_id (auth might have created user first)
        console.log(`Checking if user exists: ${email} or user_id: ${user_id}`);
        const { data: existingUserByEmail } = await supabase
            .from('users')
            .select('id, organization_id')
            .eq('email', email)
            .maybeSingle()

        const { data: existingUserById } = await supabase
            .from('users')
            .select('id, organization_id')
            .eq('id', user_id)
            .maybeSingle()

        // Use whichever user we found (prioritize user_id match if both exist)
        const existingUser = existingUserById || existingUserByEmail;

        if (existingUser) {
            console.log(`User exists (${existingUser.id}), updating with organization_id...`);
            // User exists, update with organization_id and other fields
            const updateData: Record<string, unknown> = {
                organization_id: orgId,
                full_name: full_name,
                role: 'user'
            };

            const { error: updateError } = await supabase
                .from('users')
                .update(updateData)
                .eq('id', existingUser.id)

            if (updateError) {
                console.error('Error updating user:', updateError)
                throw new Error('Failed to update user: ' + updateError.message)
            }
            console.log("User updated successfully with organization_id:", orgId);
        } else {
            console.log("Creating new user...");
            // Create new user
            const { error: insertError } = await supabase
                .from('users')
                .insert({
                    id: user_id, // Use Supabase Auth user ID
                    email: email,
                    full_name: full_name,
                    organization_id: orgId,
                    role: 'user'
                })

            if (insertError) {
                console.error('Error creating user:', insertError)
                // If user was created between our check and insert (race condition), try to update
                if (insertError.code === '23505') { // Unique constraint violation
                    console.log('User was created concurrently, attempting to update...');
                    const { data: raceConditionUser } = await supabase
                        .from('users')
                        .select('id')
                        .eq('email', email)
                        .maybeSingle();

                    if (raceConditionUser) {
                        const { error: retryUpdateError } = await supabase
                            .from('users')
                            .update({
                                organization_id: orgId,
                                full_name: full_name,
                                role: 'user'
                            })
                            .eq('id', raceConditionUser.id);

                        if (retryUpdateError) {
                            throw new Error('Failed to create/update user: ' + retryUpdateError.message)
                        }
                        console.log("User updated after race condition");
                    } else {
                        throw new Error('Failed to create user: ' + insertError.message)
                    }
                } else {
                    throw new Error('Failed to create user: ' + insertError.message)
                }
            } else {
                console.log("User created successfully with organization_id:", orgId);
            }
        }

        // If this was a deferred registration, clean up pending_organizations
        if (deferred) {
            console.log("Cleaning up pending organization for user:", user_id);
            await supabase
                .from('pending_organizations')
                .delete()
                .eq('user_id', user_id);
        }

        return new Response(
            JSON.stringify({
                organizationId: orgId,
                message: 'Organization and user registered successfully'
            }),
            {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            }
        )

    } catch (error) {
        console.error('Edge function caught error:', error)
        const errorMessage = error instanceof Error ? error.message : 'Unknown internal server error';

        return new Response(
            JSON.stringify({
                error: errorMessage,
                details: error instanceof Error ? error.toString() : 'No details'
            }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
    }
})