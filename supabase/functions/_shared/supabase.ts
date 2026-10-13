import { createClient, type SupabaseClient, type User } from 'npm:@supabase/supabase-js@2'
import { adminAccessAllowed, corsHeaders, isAdmin, jsonResponse } from './http.ts'

type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]
type PaymentMethod = 'razorpay' | 'upi_manual' | 'manual_grant'
type PaymentStatus = 'pending' | 'manual_review' | 'paid' | 'failed' | 'rejected'

type SubscriptionPaymentRow = {
  id: string
  user_id: string
  plan_id: string
  plan_title: string
  plan_days: number
  amount_paise: number
  currency: string
  payment_method: PaymentMethod
  payment_status: PaymentStatus
  razorpay_order_id: string | null
  razorpay_payment_id: string | null
  upi_reference: string | null
  utr: string | null
  gateway_method: string | null
  created_at: string
  paid_at: string | null
  expires_at: string | null
  reviewed_by: string | null
  reviewed_at: string | null
  failure_reason: string | null
}

export type Database = {
  public: {
    Tables: {
      billing_plans: {
        Row: {
          id: string
          title: string
          days: number
          amount_paise: number
          tagline: string
          popular: boolean
          active: boolean
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          id: string
          title: string
          days: number
          amount_paise: number
          tagline?: string
          popular?: boolean
          active?: boolean
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          id?: string
          title?: string
          days?: number
          amount_paise?: number
          tagline?: string
          popular?: boolean
          active?: boolean
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      subscription_payments: {
        Row: SubscriptionPaymentRow
        Insert: {
          id?: string
          user_id: string
          plan_id: string
          plan_title: string
          plan_days: number
          amount_paise: number
          currency?: string
          payment_method: PaymentMethod
          payment_status?: PaymentStatus
          razorpay_order_id?: string | null
          razorpay_payment_id?: string | null
          upi_reference?: string | null
          utr?: string | null
          gateway_method?: string | null
          created_at?: string
          paid_at?: string | null
          expires_at?: string | null
          reviewed_by?: string | null
          reviewed_at?: string | null
          failure_reason?: string | null
        }
        Update: Partial<SubscriptionPaymentRow>
        Relationships: []
      }
      user_accounts: {
        Row: { user_id: string; subscribed_until: string | null }
        Insert: { user_id: string; subscribed_until?: string | null }
        Update: { user_id?: string; subscribed_until?: string | null }
        Relationships: []
      }
      vacancies: {
        Row: { id: string; data: Json; synced_at: string }
        Insert: { id: string; data: Json; synced_at?: string }
        Update: { id?: string; data?: Json; synced_at?: string }
        Relationships: []
      }
      notifications: {
        Row: { id: string; data: Json; synced_at: string }
        Insert: { id: string; data: Json; synced_at?: string }
        Update: { id?: string; data?: Json; synced_at?: string }
        Relationships: []
      }
      push_subscriptions: {
        Row: {
          id: string
          user_id: string
          email: string
          endpoint: string
          p256dh: string
          auth: string
          user_agent: string | null
          enabled: boolean
          created_at: string
          updated_at: string
          last_seen_at: string
        }
        Insert: {
          id?: string
          user_id: string
          email: string
          endpoint: string
          p256dh: string
          auth: string
          user_agent?: string | null
          enabled?: boolean
          created_at?: string
          updated_at?: string
          last_seen_at?: string
        }
        Update: {
          user_id?: string
          email?: string
          endpoint?: string
          p256dh?: string
          auth?: string
          user_agent?: string | null
          enabled?: boolean
          updated_at?: string
          last_seen_at?: string
        }
        Relationships: []
      }
      push_delivery_log: {
        Row: {
          id: number
          notification_id: string | null
          title: string | null
          sent: number
          failed: number
          removed: number
          created_at: string
        }
        Insert: {
          notification_id?: string | null
          title?: string | null
          sent?: number
          failed?: number
          removed?: number
          created_at?: string
        }
        Update: {
          notification_id?: string | null
          title?: string | null
          sent?: number
          failed?: number
          removed?: number
        }
        Relationships: []
      }
    }
    Views: { [_ in never]: never }
    Functions: {
      save_billing_plan: {
        Args: {
          p_id: string
          p_title: string
          p_days: number
          p_amount_paise: number
          p_tagline?: string
          p_popular?: boolean
          p_active?: boolean
        }
        Returns: Json
      }
      confirm_razorpay_subscription_payment: {
        Args: {
          p_gateway_order_id: string
          p_gateway_payment_id: string
          p_paid_amount_paise: number
          p_gateway_method: string
          p_utr?: string | null
        }
        Returns: Json
      }
      review_manual_upi_subscription_payment: {
        Args: { p_payment_id: string; p_reviewer_id: string; p_approve: boolean }
        Returns: Json
      }
      admin_mfa_required: {
        Args: Record<string, never>
        Returns: boolean
      }
    }
    Enums: { [_ in never]: never }
    CompositeTypes: { [_ in never]: never }
  }
}

export type AuthenticatedContext = {
  user: User
  adminClient: SupabaseClient<Database, 'public'>
  aal2: boolean
}

// Call ONLY after Auth has verified the same bearer JWT with getUser(token).
// Claims parsed from an unverified browser value must never authorize admin work.
export function hasVerifiedAal2(token: string, userId: string): boolean {
  try {
    const payload = token.split('.')[1]
    if (!payload) return false
    const claims = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/'))) as Record<string, unknown>
    return claims.sub === userId && claims.aal === 'aal2'
  } catch { return false }
}

export function createAdminClient() {
  const url = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !serviceRoleKey) throw new Error('Supabase server configuration is missing.')
  return createClient<Database>(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

export async function authenticate(request: Request): Promise<AuthenticatedContext | Response> {
  const authorization = request.headers.get('Authorization')
  const token = authorization?.match(/^Bearer\s+(.+)$/i)?.[1]
  if (!token) return jsonResponse({ error: 'A signed-in account is required.' }, 401)

  const url = Deno.env.get('SUPABASE_URL')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? Deno.env.get('SUPABASE_PUBLISHABLE_KEY')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !anonKey || !serviceRoleKey) {
    return jsonResponse({ error: 'The secure payment service is not configured.' }, 503)
  }

  const authClient = createClient<Database>(url, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  })
  const { data: { user }, error } = await authClient.auth.getUser(token)
  if (error || !user) return jsonResponse({ error: 'Your session is invalid or expired. Please sign in again.' }, 401)

  const adminClient = createClient<Database>(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  return { user, adminClient, aal2: hasVerifiedAal2(token, user.id) }
}

export function isResponse(value: AuthenticatedContext | Response): value is Response {
  return value instanceof Response
}

export function optionsResponse(): Response {
  return new Response('ok', { headers: corsHeaders })
}

/**
 * Is the owner's sign-in code switch ON? Read from the database with the service
 * role, because public.app_settings is deliberately unreachable from a browser
 * session. Fail safe: any problem counts as "code required".
 */
export async function adminMfaRequired(client: SupabaseClient<Database, 'public'>): Promise<boolean> {
  const { data, error } = await client.rpc('admin_mfa_required')
  if (error || typeof data !== 'boolean') return true
  return data
}

/**
 * The complete administrator gate for Edge Functions: trusted admin role, and
 * either a verified code session or the owner's explicit OFF switch.
 */
export async function isAdminAllowed(
  client: SupabaseClient<Database, 'public'>,
  metadata: Record<string, unknown> | null | undefined,
  aal2: boolean,
): Promise<boolean> {
  if (!isAdmin(metadata)) return false
  return adminAccessAllowed(aal2, await adminMfaRequired(client))
}

export { adminAccessAllowed }
