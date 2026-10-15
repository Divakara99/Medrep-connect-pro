/**
 * Google Play Developer API helpers (Android Publisher v3).
 *
 * Authentication is a Google service account kept ONLY in the Supabase Edge
 * Function secret GOOGLE_PLAY_SERVICE_ACCOUNT_JSON (the full JSON key file,
 * pasted into Supabase secrets — never in the repo, never in the app). The
 * OAuth2 access token is minted per invocation with a short-lived RS256 JWT.
 *
 * Docs: https://developers.google.com/android-publisher/api-ref/rest/v3/purchases.products
 */

export const PLAY_PACKAGE_NAME = 'in.medrepconnect.app'
const ANDROID_PUBLISHER_SCOPE = 'https://www.googleapis.com/auth/androidpublisher'
const API_BASE = 'https://androidpublisher.googleapis.com/androidpublisher/v3'

export type ServiceAccount = { clientEmail: string; privateKeyPem: string }

export function parseServiceAccount(raw: string | undefined): ServiceAccount | null {
  if (!raw?.trim()) return null
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>
    const clientEmail = typeof parsed.client_email === 'string' ? parsed.client_email : ''
    const privateKeyPem = typeof parsed.private_key === 'string' ? parsed.private_key : ''
    if (!clientEmail.includes('@') || !privateKeyPem.includes('PRIVATE KEY')) return null
    return { clientEmail, privateKeyPem }
  } catch {
    return null
  }
}

/** SHA-256 hex of a purchase token — the only token-derived value we store. */
export async function purchaseTokenHash(token: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

function base64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function pemToDer(pem: string): Uint8Array {
  const body = pem.replace(/-----BEGIN [^-]+-----/g, '').replace(/-----END [^-]+-----/g, '').replace(/\s+/g, '')
  const binary = atob(body)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return bytes
}

async function serviceAccountAccessToken(
  account: ServiceAccount,
  fetchFn: typeof fetch,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): Promise<string> {
  const header = base64Url(new TextEncoder().encode(JSON.stringify({ alg: 'RS256', typ: 'JWT' })))
  const claims = base64Url(new TextEncoder().encode(JSON.stringify({
    iss: account.clientEmail,
    scope: ANDROID_PUBLISHER_SCOPE,
    aud: 'https://oauth2.googleapis.com/token',
    iat: nowSeconds,
    exp: nowSeconds + 3600,
  })))
  const unsigned = `${header}.${claims}`
  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemToDer(account.privateKeyPem) as BufferSource,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signature = new Uint8Array(
    await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(unsigned) as BufferSource),
  )
  const assertion = `${unsigned}.${base64Url(signature)}`

  const response = await fetchFn('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  })
  if (!response.ok) throw new Error(`Google OAuth failed (${response.status}).`)
  const payload = await response.json() as { access_token?: unknown }
  if (typeof payload.access_token !== 'string' || !payload.access_token) {
    throw new Error('Google OAuth returned no access token.')
  }
  return payload.access_token
}

export type ProductPurchase = {
  purchaseState?: number // 0 purchased, 1 cancelled, 2 pending
  consumptionState?: number // 0 not consumed, 1 consumed
  acknowledgementState?: number // 0 not acknowledged, 1 acknowledged
  orderId?: string
  productId?: string
  purchaseTimeMillis?: string
  regionCode?: string
  quantity?: number
}

/** 'purchased' | 'pending' | 'cancelled' from Play's numeric purchaseState. */
export function classifyPurchase(purchase: ProductPurchase | null | undefined): 'purchased' | 'pending' | 'cancelled' | 'unknown' {
  if (!purchase) return 'unknown'
  if (purchase.purchaseState === 0) return 'purchased'
  if (purchase.purchaseState === 2) return 'pending'
  if (purchase.purchaseState === 1) return 'cancelled'
  return 'unknown'
}

export class PlayApi {
  private accessToken: string

  private constructor(accessToken: string) {
    this.accessToken = accessToken
  }

  static async create(account: ServiceAccount, fetchFn: typeof fetch = fetch): Promise<PlayApi> {
    return new PlayApi(await serviceAccountAccessToken(account, fetchFn))
  }

  private async request(path: string, method: 'GET' | 'POST' = 'GET', fetchFn: typeof fetch = fetch): Promise<unknown> {
    const response = await fetchFn(`${API_BASE}/applications/${PLAY_PACKAGE_NAME}${path}`, {
      method,
      headers: { Authorization: `Bearer ${this.accessToken}` },
    })
    if (!response.ok) {
      throw new Error(`Google Play Developer API failed (${response.status}) for ${path}.`)
    }
    if (response.status === 204) return null
    const textBody = await response.text()
    return textBody ? JSON.parse(textBody) as unknown : null
  }

  async getProductPurchase(productId: string, token: string, fetchFn: typeof fetch = fetch): Promise<ProductPurchase> {
    const payload = await this.request(
      `/purchases/products/${encodeURIComponent(productId)}/tokens/${encodeURIComponent(token)}`,
      'GET',
      fetchFn,
    )
    return (payload ?? {}) as ProductPurchase
  }

  async acknowledge(productId: string, token: string, fetchFn: typeof fetch = fetch): Promise<void> {
    await this.request(
      `/purchases/products/${encodeURIComponent(productId)}/tokens/${encodeURIComponent(token)}:acknowledge`,
      'POST',
      fetchFn,
    )
  }

  async consume(productId: string, token: string, fetchFn: typeof fetch = fetch): Promise<void> {
    await this.request(
      `/purchases/products/${encodeURIComponent(productId)}/tokens/${encodeURIComponent(token)}:consume`,
      'POST',
      fetchFn,
    )
  }

  /**
   * Purchases Google has refunded/voided since `startTimeMillis`. Used to
   * reconcile chargebacks: each token found here is marked refunded in the
   * database (handle_google_play_voided_purchase claws days back only when
   * safe). type=0 is the orders-with-refunds list.
   */
  async listVoided(startTimeMillis: number, fetchFn: typeof fetch = fetch): Promise<{ purchaseToken?: string; voidedReason?: number; orderId?: string }[]> {
    const payload = await this.request(
      `/purchases/voidedpurchases?startTime=${startTimeMillis}&type=1`,
      'GET',
      fetchFn,
    ) as { voidedPurchases?: { purchaseToken?: string; voidedReason?: number; orderId?: string }[] } | null
    return payload?.voidedPurchases ?? []
  }
}
