import {
  adminAccessAllowed,
  adminMfaRequired,
  authenticate,
  isResponse,
  optionsResponse,
  type AuthenticatedContext,
} from '../_shared/supabase.ts'
import { isAdmin, isVacancyEditor, jsonResponse, readJson } from '../_shared/http.ts'
import { buildPushPayload, isGoneStatus, sendWebPush, type PushSubscriptionRecord, type VapidKeys } from '../_shared/webpush.ts'

/**
 * Web Push fan-out for MedRep Connect Pro.
 *
 * Actions
 *   config  — public. Reports whether VAPID keys are configured, and returns the
 *             public key the browser needs to subscribe. No secrets leave here.
 *   test    — any signed-in user. Sends one test notification to that user's own
 *             devices, so they can confirm the phone really rings.
 *   notify  — administrator (verified code session, or the code switch is OFF) or
 *             vacancy team member: delivers an existing broadcast notification
 *             (announcement, job post, job edit) to every subscribed device.
 *   job     — administrator or vacancy team: delivers the notification created for
 *             one vacancy (used right after posting/editing, including posts made
 *             by the vacancy team, whose rows are written by the database).
 *
 * The message text always comes from the server-side notification row or from the
 * vacancy row itself — never from the request body — so a signed-in account cannot
 * push arbitrary words to every phone. Subscriptions the push service reports as
 * gone (404/410) are deleted. Every batch is written to public.push_delivery_log,
 * which the admin console reads to show how many devices were actually reached.
 */

/** Keep one invocation inside the Edge Function time limit. */
const MAX_DEVICES_PER_CALL = 1000
const ACTIONS = new Set(['config', 'test', 'notify', 'job'])

/**
 * A subscription is dead when the push service says it is gone (404/410), and
 * unusable when it rejects the request as bad (any other 4xx). Rate limiting
 * (429) is temporary, so the device is kept.
 */
function subscriptionIsDead(status: number, gone: boolean): boolean {
  if (gone || isGoneStatus(status)) return true
  return status >= 400 && status < 500 && status !== 429
}

type NotificationRow = {
  id: string
  title: string
  body: string
  type: string
  target: 'all' | string[]
  jobId?: string
}

function vapidKeys(): VapidKeys | null {
  const publicKey = (Deno.env.get('VAPID_PUBLIC_KEY') ?? '').trim()
  const privateKey = (Deno.env.get('VAPID_PRIVATE_KEY') ?? '').trim()
  const subject = (Deno.env.get('VAPID_SUBJECT') ?? '').trim()
  if (!publicKey || !privateKey || !subject) return null
  return { publicKey, privateKey, subject }
}

/** The server-side notification row, in the shape the app uses. */
function toNotificationRow(id: string, data: unknown): NotificationRow | null {
  if (!data || typeof data !== 'object') return null
  const row = data as Record<string, unknown>
  const target = row.target === 'all' || row.target === undefined
    ? 'all' as const
    : Array.isArray(row.target)
      ? row.target.filter((value): value is string => typeof value === 'string')
      : 'all' as const
  const meta = (row.meta && typeof row.meta === 'object' ? row.meta : {}) as Record<string, unknown>
  return {
    id,
    title: typeof row.title === 'string' ? row.title : 'MedRep Connect Pro',
    body: typeof row.body === 'string' ? row.body : '',
    type: typeof row.type === 'string' ? row.type : 'update',
    target,
    jobId: typeof meta.jobId === 'string' ? meta.jobId : undefined,
  }
}

async function loadNotification(context: AuthenticatedContext, body: Record<string, unknown> | null): Promise<NotificationRow | null> {
  const notificationId = typeof body?.notificationId === 'string' ? body.notificationId : ''
  if (notificationId) {
    const { data, error } = await context.adminClient
      .from('notifications')
      .select('id,data')
      .eq('id', notificationId)
      .maybeSingle()
    if (error || !data) return null
    return toNotificationRow(data.id, data.data)
  }

  const jobId = typeof body?.jobId === 'string' ? body.jobId : ''
  if (!jobId) return null
  // The newest notice for this vacancy — created either by the poster's device
  // (administrator) or by the database function used by the vacancy team.
  const { data } = await context.adminClient
    .from('notifications')
    .select('id,data')
    .eq('data->meta->>jobId', jobId)
    .order('synced_at', { ascending: false })
    .limit(1)
  const row = Array.isArray(data) ? data[0] : null
  if (row) return toNotificationRow(row.id, row.data)

  // No row yet (for example a vacancy posted before notifications were mirrored):
  // build the short notice from the vacancy itself.
  const { data: vacancy } = await context.adminClient
    .from('vacancies')
    .select('data')
    .eq('id', jobId)
    .maybeSingle()
  const job = (vacancy?.data && typeof vacancy.data === 'object' ? vacancy.data : null) as Record<string, unknown> | null
  if (!job) return null
  const title = typeof job.title === 'string' ? job.title : 'New vacancy'
  const category = typeof job.category === 'string' ? job.category : 'Role'
  const location = typeof job.location === 'string' ? job.location : ''
  return {
    id: `job:${jobId}`,
    title: `New ${category} opening`,
    body: `${title}${location ? ` · ${location}` : ''}. Open the app to view the vacancy and apply.`,
    type: 'job',
    target: 'all',
    jobId,
  }
}

async function fanOut(
  context: AuthenticatedContext,
  keys: VapidKeys,
  notification: NotificationRow,
): Promise<{ sent: number; failed: number; removed: number; devices: number }> {
  let query = context.adminClient
    .from('push_subscriptions')
    .select('id,endpoint,p256dh,auth,email')
    .eq('enabled', true)
    .limit(MAX_DEVICES_PER_CALL)
  if (notification.target !== 'all') {
    query = query.in('email', notification.target)
  }
  const { data, error } = await query
  if (error) throw new Error(error.message)

  const devices = (data ?? []) as (PushSubscriptionRecord & { id: string; email: string })[]
  const payload = buildPushPayload({
    title: notification.title,
    body: notification.body,
    notificationId: notification.id,
    tag: notification.id,
    type: notification.type,
  })

  let sent = 0
  let failed = 0
  const removed: string[] = []

  // The push services are called in parallel batches so a large audience does not
  // serialise into a request timeout.
  const batchSize = 25
  for (let index = 0; index < devices.length; index += batchSize) {
    const batch = devices.slice(index, index + batchSize)
    const results = await Promise.all(batch.map(async (device) => ({
      device,
      result: await sendWebPush(fetch, device, payload, keys, { urgency: 'high', ttlSeconds: 60 * 60 * 24 }),
    })))
    for (const { device, result } of results) {
      if (result.ok) sent += 1
      else failed += 1
      if (subscriptionIsDead(result.status, result.gone)) removed.push(device.id)
    }
  }

  if (removed.length > 0) {
    await context.adminClient.from('push_subscriptions').delete().in('id', removed)
  }

  await context.adminClient.from('push_delivery_log').insert({
    notification_id: notification.id,
    title: notification.title.slice(0, 160),
    sent,
    failed,
    removed: removed.length,
  })

  return { sent, failed, removed: removed.length, devices: devices.length }
}

Deno.serve(async (request: Request) => {
  if (request.method === 'OPTIONS') return optionsResponse()
  if (request.method !== 'POST') return jsonResponse({ error: 'Method not allowed.' }, 405)

  const body = await readJson(request)
  const action = typeof body?.action === 'string' ? body.action : 'config'
  if (!ACTIONS.has(action)) return jsonResponse({ error: 'Unsupported notification action.' }, 400)

  const keys = vapidKeys()

  // ---- Public configuration: the browser needs the VAPID public key ----
  if (action === 'config') {
    return jsonResponse({
      ok: true,
      configured: keys !== null,
      publicKey: keys?.publicKey ?? null,
    })
  }

  if (!keys) {
    return jsonResponse({
      error: 'Phone notifications are not configured on the server yet (VAPID keys are missing).',
      configured: false,
    }, 503)
  }

  const context = await authenticate(request)
  if (isResponse(context)) return context

  // ---- A user testing their own phone ----
  if (action === 'test') {
    const { data, error } = await context.adminClient
      .from('push_subscriptions')
      .select('id,endpoint,p256dh,auth')
      .eq('user_id', context.user.id)
      .eq('enabled', true)
      .limit(10)
    if (error) return jsonResponse({ error: 'Your notification devices could not be read.' }, 500)
    const devices = (data ?? []) as PushSubscriptionRecord[]
    if (devices.length === 0) {
      return jsonResponse({ ok: false, devices: 0, error: 'This device is not subscribed yet. Turn on notifications in the app first.' }, 409)
    }
    const payload = buildPushPayload({
      title: 'MedRep Connect Pro',
      body: 'Test notification — announcements and new vacancies will arrive like this.',
      tag: 'mrc-test',
      type: 'system',
    })
    const results = await Promise.all(devices.map((device) => sendWebPush(fetch, device, payload, keys, { urgency: 'high' })))
    const sent = results.filter((result) => result.ok).length
    return jsonResponse({ ok: sent > 0, devices: devices.length, sent })
  }

  // ---- Delivering an announcement / job notice to everyone ----
  const mfaRequired = await adminMfaRequired(context.adminClient)
  const admin = isAdmin(context.user.app_metadata)
    && adminAccessAllowed(context.aal2, mfaRequired)
  const teamMember = isVacancyEditor(context.user.app_metadata)
  if (!admin && !(teamMember && action === 'job')) {
    return jsonResponse({
      error: admin || teamMember
        ? 'Verify your authenticator code (MFA) before sending notifications.'
        : 'An administrator account is required.',
    }, 403)
  }

  const notification = await loadNotification(context, body)
  if (!notification) return jsonResponse({ error: 'That notice could not be found.' }, 404)

  try {
    const summary = await fanOut(context, keys, notification)
    return jsonResponse({ ok: true, ...summary })
  } catch (cause) {
    console.error('Push fan-out failed:', cause instanceof Error ? cause.message : cause)
    return jsonResponse({ error: 'Notifications could not be delivered right now.' }, 502)
  }
})
