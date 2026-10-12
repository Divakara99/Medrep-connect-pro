import { createClient } from 'npm:@supabase/supabase-js@2'
import { hasVerifiedAal2 } from '../_shared/supabase.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function isAdmin(metadata: Record<string, unknown> | null | undefined): boolean {
  return metadata?.role === 'admin' || metadata?.is_admin === true || metadata?.is_admin === 'true'
}

Deno.serve(async (request: Request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return jsonResponse({ error: 'Method not allowed.' }, 405)

  const authorization = request.headers.get('Authorization')
  const token = authorization?.match(/^Bearer\s+(.+)$/i)?.[1]
  if (!token) return jsonResponse({ error: 'A Supabase Auth session is required.' }, 401)

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return jsonResponse({ error: 'The account deletion service is not configured.' }, 500)
  }

  // Validate the caller's JWT with Auth. Never trust a role supplied in the
  // request body or user-editable user_metadata.
  const authClient = createClient(supabaseUrl, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  })
  const { data: { user: actor }, error: authError } = await authClient.auth.getUser(token)
  if (authError || !actor) return jsonResponse({ error: 'The Supabase session is invalid or expired.' }, 401)
  if (!isAdmin(actor.app_metadata) || !hasVerifiedAal2(token, actor.id)) {
    return jsonResponse({ error: 'A verified administrator authenticator is required.' }, 403)
  }

  let body: { userId?: unknown }
  try {
    body = await request.json() as { userId?: unknown }
  } catch {
    return jsonResponse({ error: 'A valid account ID is required.' }, 400)
  }
  const targetId = typeof body.userId === 'string' ? body.userId : ''
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(targetId)) {
    return jsonResponse({ error: 'A valid account ID is required.' }, 400)
  }
  if (targetId === actor.id) return jsonResponse({ error: 'You cannot delete the active administrator account.' }, 409)

  // This client is server-only. Its key is never returned to the browser; all
  // destructive requests are guarded by the verified administrator JWT above.
  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const { data: { user: target }, error: targetError } = await adminClient.auth.admin.getUserById(targetId)
  if (targetError) return jsonResponse({ error: 'Could not verify the target account.' }, 500)
  if (!target) return jsonResponse({ error: 'The account no longer exists.' }, 404)
  if (isAdmin(target.app_metadata)) {
    return jsonResponse({ error: 'Administrator accounts are protected from this action.' }, 409)
  }

  const { error: deleteError } = await adminClient.auth.admin.deleteUser(targetId)
  if (deleteError) return jsonResponse({ error: 'Supabase could not delete this account.' }, 500)

  return jsonResponse({ ok: true })
})
