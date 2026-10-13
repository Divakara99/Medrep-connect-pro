import { createClient } from 'npm:@supabase/supabase-js@2'
import { hasVerifiedAal2 } from '../_shared/supabase.ts'

/**
 * Administrator-only management of vacancy team logins.
 *
 *   list          -> the team logins
 *   create        -> { email, name, password }: a new login ID and password
 *   resetPassword -> { userId, password }: a new password for a team login
 *   delete        -> { userId }: removes a team login (never an admin or a user)
 *
 * Only an administrator with a verified authenticator (aal2) can call it. The
 * service-role key stays on the server. Team logins are the only accounts this
 * function creates, and it always sets the vacancy_editor role itself.
 */

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const TEAM_ROLE = 'vacancy_editor'
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function isAdmin(metadata: Record<string, unknown> | null | undefined): boolean {
  return metadata?.role === 'admin' || metadata?.is_admin === true || metadata?.is_admin === 'true'
}

function isTeamLogin(metadata: Record<string, unknown> | null | undefined): boolean {
  return metadata?.role === TEAM_ROLE
}

function passwordProblem(password: unknown): string | null {
  if (typeof password !== 'string' || password.length < 12) return 'The password must be at least 12 characters.'
  if (password.length > 72) return 'The password must be at most 72 characters.'
  return null
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
    return jsonResponse({ error: 'The team login service is not configured.' }, 500)
  }

  const authClient = createClient(supabaseUrl, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  })
  const { data: { user: actor }, error: authError } = await authClient.auth.getUser(token)
  if (authError || !actor) return jsonResponse({ error: 'The Supabase session is invalid or expired.' }, 401)
  if (!isAdmin(actor.app_metadata)) return jsonResponse({ error: 'An administrator account is required.' }, 403)
  if (!hasVerifiedAal2(token, actor.id)) {
    return jsonResponse({ error: 'Verify your authenticator code (MFA) before managing team logins.' }, 403)
  }

  let body: Record<string, unknown>
  try {
    body = await request.json() as Record<string, unknown>
  } catch {
    return jsonResponse({ error: 'A valid request body is required.' }, 400)
  }
  const action = typeof body.action === 'string' ? body.action : ''

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  if (action === 'list') {
    const { data, error } = await adminClient
      .from('vacancy_employees')
      .select('user_id,email,name,created_at')
      .order('created_at', { ascending: false })
    if (error) return jsonResponse({ error: 'Team logins could not be loaded.' }, 500)
    return jsonResponse({ employees: data ?? [] })
  }

  if (action === 'create') {
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
    const name = typeof body.name === 'string' ? body.name.trim() : ''
    if (!EMAIL_PATTERN.test(email)) return jsonResponse({ error: 'Enter a valid login ID (email address).' }, 400)
    if (name.length < 2 || name.length > 120) return jsonResponse({ error: 'Enter the employee name (2 to 120 characters).' }, 400)
    const problem = passwordProblem(body.password)
    if (problem) return jsonResponse({ error: problem }, 400)

    const { data: created, error: createError } = await adminClient.auth.admin.createUser({
      email,
      password: body.password as string,
      email_confirm: true,
      app_metadata: { role: TEAM_ROLE, created_by: actor.id },
      user_metadata: { name },
    })
    if (createError || !created.user) {
      const message = /already|registered|exists/i.test(createError?.message ?? '')
        ? 'This login ID is already in use. Choose another email address.'
        : 'The team login could not be created.'
      return jsonResponse({ error: message }, 409)
    }

    const { error: rowError } = await adminClient.from('vacancy_employees').insert({
      user_id: created.user.id,
      email,
      name,
      created_by: actor.id,
    })
    if (rowError) {
      // Keep the list and the accounts in step: undo the new login.
      await adminClient.auth.admin.deleteUser(created.user.id)
      return jsonResponse({ error: 'The team login could not be saved. Nothing was created.' }, 500)
    }
    return jsonResponse({ ok: true, employee: { user_id: created.user.id, email, name } }, 201)
  }

  if (action === 'resetPassword' || action === 'delete') {
    const targetId = typeof body.userId === 'string' ? body.userId : ''
    if (!UUID_PATTERN.test(targetId)) return jsonResponse({ error: 'A valid team login is required.' }, 400)

    const { data: { user: target }, error: targetError } = await adminClient.auth.admin.getUserById(targetId)
    if (targetError) return jsonResponse({ error: 'Could not verify the team login.' }, 500)
    if (!target) return jsonResponse({ error: 'That team login no longer exists.' }, 404)
    if (!isTeamLogin(target.app_metadata)) {
      return jsonResponse({ error: 'Only vacancy team logins can be changed here.' }, 409)
    }

    if (action === 'resetPassword') {
      const problem = passwordProblem(body.password)
      if (problem) return jsonResponse({ error: problem }, 400)
      const { error } = await adminClient.auth.admin.updateUserById(targetId, { password: body.password as string })
      if (error) return jsonResponse({ error: 'The password could not be changed.' }, 500)
      return jsonResponse({ ok: true })
    }

    const { error } = await adminClient.auth.admin.deleteUser(targetId)
    if (error) return jsonResponse({ error: 'Supabase could not delete this team login.' }, 500)
    return jsonResponse({ ok: true })
  }

  return jsonResponse({ error: 'Unknown action.' }, 400)
})
