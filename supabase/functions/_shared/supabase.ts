import { createClient, type SupabaseClient, type User } from 'npm:@supabase/supabase-js@2'
import { corsHeaders, jsonResponse } from './http.ts'

type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]
type PaymentMethod = 'razorpay' | 'upi_manual'
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
    }
    Views: { [_ in never]: never }
    Functions: {
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
    }
    Enums: { [_ in never]: never }
    CompositeTypes: { [_ in never]: never }
  }
}

export type AuthenticatedContext = {
  user: User
  adminClient: SupabaseClient<Database, 'public'>
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
  return { user, adminClient }
}

export function isResponse(value: AuthenticatedContext | Response): value is Response {
  return value instanceof Response
}

export function optionsResponse(): Response {
  return new Response('ok', { headers: corsHeaders })
}
