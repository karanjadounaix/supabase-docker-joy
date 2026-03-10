/**
 * Supabase Edge Function to proxy Fellow.app API requests
 * This avoids CORS issues when calling Fellow API from the browser
 * Authentication is handled by Fellow API key - no Supabase auth required
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Helper to normalize subdomain/baseUrl - handles all formats
function getFellowBaseUrl(subdomain: string, baseUrl?: string): string {
  if (baseUrl) return baseUrl.replace(/\/$/, '')
  if (subdomain.startsWith('http://') || subdomain.startsWith('https://')) {
    return subdomain.replace(/\/$/, '')
  }
  if (subdomain.includes('.fellow.app')) {
    return `https://${subdomain}`.replace(/\/$/, '')
  }
  return `https://${subdomain}.fellow.app`
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const body = await req.json()
    const { action, apiKey, subdomain, baseUrl, limit, include, recordingId, noteId } = body

    if (!apiKey || !subdomain) {
      return new Response(
        JSON.stringify({ error: 'Missing API key or subdomain' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const fellowBase = getFellowBaseUrl(subdomain, baseUrl)
    console.log(`[fellow-proxy] Base URL: ${fellowBase}`)

    if (action === 'getRecordings') {
      const response = await fetch(`${fellowBase}/api/v1/recordings`, {
        method: 'POST',
        headers: { 'X-API-KEY': apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          include: include || { transcript: true, attendees: true, participants: true, users: true, members: true, summary: true, action_items: true, keywords: true },
          limit: limit || 50,
        }),
      })

      if (!response.ok) {
        const errorText = await response.text()
        let errorMessage = `Fellow API error: ${response.status}`
        try { errorMessage = JSON.parse(errorText).error || JSON.parse(errorText).message || errorMessage } catch {}
        return new Response(JSON.stringify({ error: errorMessage }), { status: response.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
      }

      return new Response(JSON.stringify(await response.json()), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    if (action === 'testConnection') {
      const response = await fetch(`${fellowBase}/api/v1/recordings`, {
        method: 'POST',
        headers: { 'X-API-KEY': apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ include: {}, limit: 1 }),
      })
      return new Response(JSON.stringify({ success: response.ok }), { status: response.ok ? 200 : response.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    if (action === 'getRecording') {
      if (!recordingId) return new Response(JSON.stringify({ error: 'Missing recording ID' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
      const response = await fetch(`${fellowBase}/api/v1/recordings/${recordingId}`, { method: 'GET', headers: { 'X-API-KEY': apiKey, 'Content-Type': 'application/json' } })
      if (!response.ok) return new Response(JSON.stringify({ error: `Fellow API error: ${response.status}` }), { status: response.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
      return new Response(JSON.stringify(await response.json()), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    if (action === 'getNotes') {
      const notesLimit = limit || 100
      let response = await fetch(`${fellowBase}/api/v1/notes?limit=${notesLimit}`, { method: 'GET', headers: { 'X-API-KEY': apiKey, 'Content-Type': 'application/json' } })
      if (response.status === 404 || response.status === 405) {
        response = await fetch(`${fellowBase}/api/v1/notes`, { method: 'POST', headers: { 'X-API-KEY': apiKey, 'Content-Type': 'application/json' }, body: JSON.stringify({ limit: notesLimit }) })
      }
      if (!response.ok) {
        const errorText = await response.text()
        let errorMessage = `Fellow Notes API error: ${response.status}`
        try { errorMessage = JSON.parse(errorText).error || JSON.parse(errorText).message || errorMessage } catch {}
        return new Response(JSON.stringify({ error: errorMessage }), { status: response.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
      }
      return new Response(JSON.stringify(await response.json()), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    if (action === 'getNote') {
      if (!noteId) return new Response(JSON.stringify({ error: 'Missing note ID' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
      const response = await fetch(`${fellowBase}/api/v1/note/${noteId}`, { method: 'GET', headers: { 'X-API-KEY': apiKey, 'Content-Type': 'application/json' } })
      if (!response.ok) return new Response(JSON.stringify({ error: `Fellow API error: ${response.status}` }), { status: response.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
      return new Response(JSON.stringify(await response.json()), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    return new Response(JSON.stringify({ error: 'Unknown action' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  } catch (error) {
    console.error('Edge function error:', error)
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : 'Internal server error' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  }
})
