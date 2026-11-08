import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

/**
 * The ₹5 single-job unlock, in four rules:
 *
 *   1. One payment buys ONE job for ONE hour — never a pass, never permanent,
 *      never auto-renewed.
 *   2. The price is decided on the server (500 paise), and the database refuses
 *      any other amount. The browser never sends money.
 *   3. Only a verified, captured Razorpay payment can start the hour; users can
 *      read their own rows and nothing else.
 *   4. It lives where ₹5 is possible — the website. Play's lowest in-app price
 *      in India is ₹10, so the app keeps the free video unlock and never opens
 *      Razorpay.
 */

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8')

const sql = await read('supabase/job_unlocks.sql')
const createFn = await read('supabase/functions/create-job-unlock-order/index.ts')
const verifyFn = await read('supabase/functions/verify-job-unlock/index.ts')
const buyer = await read('src/data/jobUnlock.ts')
const razorpay = await read('src/data/razorpay.ts')
const jobs = await read('src/data/jobs.ts')
const detail = await read('src/components/JobDetail.tsx')
const app = await read('src/App.tsx')

// 1. One job, one hour, one payment -------------------------------------------
assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.job_unlocks/, 'paid unlocks have their own table')
assert.match(sql, /CONSTRAINT job_unlocks_order_unique UNIQUE \(razorpay_order_id\)/, 'one row per Razorpay order')
assert.match(sql, /CONSTRAINT job_unlocks_payment_unique UNIQUE \(razorpay_payment_id\)/, 'one row per Razorpay payment')
assert.match(sql, /CONSTRAINT job_unlocks_price_fixed CHECK \(amount_paise = 500\)/, 'the database refuses any price but ₹5')
assert.match(sql, /expires_at timestamptz/, 'the window is stored, not inferred')
assert.doesNotMatch(sql, /auto_?renew|recurring/i, 'nothing renews by itself')

// 2. The window is paid-only and one job wide ---------------------------------
assert.match(sql, /ju\.payment_status = 'paid' AND ju\.expires_at > now\(\)/,
  'a pending or lapsed row reveals nothing')
const paidBranch = sql.indexOf("WHEN EXISTS (\n        SELECT 1 FROM public.job_unlocks AS ju")
const videoBranch = sql.indexOf('FROM public.company_unlocks AS cu\n        WHERE cu.user_id = auth.uid()', paidBranch)
assert.ok(paidBranch > 0 && videoBranch > paidBranch, 'the paid unlock is projected before the video unlock')
for (const field of ['company', 'manager', 'contact', 'managerAltPhone', 'managerEmail']) {
  const projection = sql.slice(paidBranch, videoBranch)
  assert.ok(projection.includes(`'${field}'`), `a paid unlock reveals ${field} for that job only`)
}
assert.match(sql, /ju\.job_id = v\.id/, 'the paid branch is scoped to this exact vacancy')
assert.match(sql, /'jobUnlockExpiresAt'/, 'the app gets a countdown from the same read')

// 3. Users read their own rows and can write nothing --------------------------
assert.match(sql, /ENABLE ROW LEVEL SECURITY/, 'RLS is on')
assert.match(sql, /CREATE POLICY job_unlocks_read_own ON public\.job_unlocks/, 'own-row read policy exists')
assert.match(sql, /USING \(user_id = \(SELECT auth\.uid\(\)\)\)/, 'the policy is the signed-in user')
assert.match(sql, /REVOKE ALL ON public\.job_unlocks FROM PUBLIC, anon, authenticated/, 'the table is not world-readable')
assert.match(sql, /GRANT SELECT ON public\.job_unlocks TO authenticated/, 'signed-in users may only read')
assert.doesNotMatch(sql, /GRANT (INSERT|UPDATE|DELETE|ALL) ON public\.job_unlocks TO (anon|authenticated)/,
  'no browser can grant itself an unlock')
assert.doesNotMatch(sql, /CREATE POLICY job_unlocks_(write|insert|update)/, 'no write policy exists')

// 4. The price is server-decided, the job must be live ------------------------
assert.match(createFn, /const JOB_UNLOCK_PRICE_PAISE = 500/, 'the Edge Function owns the ₹5 price')
assert.match(createFn, /amountPaise: JOB_UNLOCK_PRICE_PAISE/, 'the Razorpay order uses that price')
assert.doesNotMatch(createFn, /body\?\.(amount|amountPaise|price|paise)/, 'the browser cannot send an amount')
assert.match(createFn, /data\.deleted === true \|\| data\.deleted === 'true'/, 'a deleted vacancy cannot be sold')
assert.match(createFn, /user_id: context\.user\.id/, 'the order belongs to the signed-in user')
assert.match(createFn, /payment_status: 'pending'/, 'a new order reveals nothing yet')
assert.match(createFn, /notes: \{[\s\S]*job_id: jobId/, 'the job travels with the gateway order')

// 5. Verification: signature, exact amount, capture, one hour ----------------
assert.match(verifyFn, /const JOB_UNLOCK_MINUTES = 60/, 'the window is one hour')
assert.match(verifyFn, /verifyCheckoutSignature\(secret, orderId, paymentId, signature\)/, 'the signature is verified server-side')
assert.match(verifyFn, /payment\.amount !== JOB_UNLOCK_PRICE_PAISE/, 'a payment of any other amount is refused')
assert.match(verifyFn, /payment\.status !== 'captured'/, 'only a captured payment starts the hour')
assert.match(verifyFn, /\.eq\('payment_status', 'pending'\)/, 'only a pending row can be paid')
assert.match(verifyFn, /expires_at: expiresAt/, 'the server stamps the expiry')
assert.match(verifyFn, /alreadyConfirmed: true/, 'a replayed confirmation buys no second hour')
assert.match(verifyFn, /\.eq\('user_id', context\.user\.id\)/, 'orders are scoped to their owner')
assert.ok(
  verifyFn.indexOf("payment_status: 'paid'") > verifyFn.indexOf('captured'),
  'the row is marked paid only after capture',
)

// 6. The client never decides price or visibility -----------------------------
assert.match(razorpay, /createJobUnlockOrder\(jobId: string\)/, 'the order call takes only a job id')
assert.doesNotMatch(razorpay, /amount[^s][\s\S]{0,40}planId[\s\S]{0,40}jobId/i, 'no client-side pricing of unlocks')
assert.match(buyer, /export const JOB_UNLOCK_PRICE_RUPEES = 5/, 'the label says ₹5')
assert.match(buyer, /return !isNativeApp\(\)/, 'the paid unlock is a website feature')
assert.match(buyer, /Play's lowest in-app price in India is ₹10/, 'the reason the app has no ₹5 product is written down')
assert.match(buyer, /'Payment cancelled\. Nothing was charged\.'/, 'a dismissed checkout says plainly that nothing was charged')

// 7. The job projection carries the paid window ------------------------------
assert.match(jobs, /jobUnlocked\?: boolean/, 'the job model reads the paid flag')
assert.match(jobs, /jobUnlockExpiresAt\?: string \| null/, 'the job model reads the paid expiry')

// 8. The sheet offers it only where it can be paid ---------------------------
assert.match(detail, /paidUnlock\?: \{ available: boolean; busy: boolean; onBuy: \(job: Job\) => void \}/,
  'the sheet takes the paid unlock as a capability')
assert.match(detail, /paidUnlock\?\.available && \(/, 'the ₹5 button appears only when it is available')
assert.match(detail, /jobUnlockLabel\(\)/, 'the button shows the price and the window')
assert.match(detail, /Full contact unlocked for this job/, 'an active paid window is stated with its countdown')
assert.match(detail, /const fullDetails = Boolean\(job && \(unlocked \|\| paidWindow\.active\)\)/,
  'a paid window reveals the contact block, like a pass would for this sheet')
assert.match(app, /available: paidJobUnlockAvailable\(\) && !unlocked/, 'the app offers it only outside the app')
assert.match(app, /await buyJobUnlock\(\{ id: job\.id, title: job\.title \}/, 'the buy runs through the verified helper')
assert.match(app, /const fresh = await loadVisibleJobs\(\)/, 'after paying, the server projection is re-read')

console.log('job unlock: ₹5 buys one job for one hour, server-priced and verified, own-row reads only, website-only — passed')
