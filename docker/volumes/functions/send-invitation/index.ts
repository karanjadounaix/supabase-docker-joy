import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseServiceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const resendApiKey = Deno.env.get('RESEND_API_KEY')
    const appUrl = Deno.env.get('APP_URL') || 'http://localhost:5173'
    const fromEmail = Deno.env.get('RESEND_FROM_EMAIL') || 'onboarding@resend.dev'
    const appName = Deno.env.get('APP_NAME') || 'Agent Joy'

    if (!resendApiKey) {
      return new Response(
        JSON.stringify({ error: 'RESEND_API_KEY not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const supabase = createClient(supabaseUrl, supabaseServiceRoleKey)
    const { invitation_id } = await req.json()

    const { data: invitation, error } = await supabase
      .from('invitations')
      .select('*, organizations(name), users!invitations_invited_by_fkey(full_name, email)')
      .eq('id', invitation_id)
      .single()

    if (error || !invitation) {
      throw new Error('Invitation not found')
    }

    const { email, token, organizations, users: inviter } = invitation
    const organizationName = organizations?.name || 'an organization'
    const inviterName = inviter?.full_name || inviter?.email || 'A team member'
    
    const inviteUrl = `${appUrl.replace(/\/$/, '')}/join-team?token=${token}`

    const resendRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${resendApiKey}`
      },
      body: JSON.stringify({
        from: fromEmail,
        to: email,
        subject: `Join ${organizationName} on ${appName}`,
        html: `
          <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
            <h2 style="color: #1a1a1a;">You've been invited!</h2>
            <p style="color: #4a4a4a; font-size: 16px;">
              <strong>${inviterName}</strong> has invited you to join <strong>${organizationName}</strong> on ${appName}.
            </p>
            <div style="margin: 30px 0;">
              <a href="${inviteUrl}" style="background: linear-gradient(135deg, #0070f3 0%, #00b4d8 100%); color: white; padding: 14px 28px; text-decoration: none; border-radius: 8px; display: inline-block; font-weight: 600;">
                Accept Invitation
              </a>
            </div>
            <p style="color: #888; font-size: 12px;">
              This invitation expires in 7 days. If you didn't expect this invitation, you can safely ignore this email.
            </p>
          </div>
        `
      })
    })

    const resendData = await resendRes.json()
    if (!resendRes.ok) {
      throw new Error(resendData.message || 'Failed to send email')
    }

    return new Response(
      JSON.stringify({ success: true, id: resendData.id }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})