import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

/**
 * The ₹5 single-job unlock, in four rules:
 *
 *   1. One payment buys ONE job for 24 hours — never a pass, never a
 *      subscription; older permanent unlocks are grandfathered.
 *   2. The price is decided on the server (500 paise), and the database refuses
 *      any other amount. The browser never sends money.
 *   3. Only a verified, captured Razorpay payment can open it; users can read
 *      their own rows and nothing else.
 *   4. It is bought where ₹5 is possible — the website. Play's lowest in-app
 *      price in India is ₹10, so the app keeps the free video unlock and never
 *      opens Razorpay.
 */

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8')

const sql = await read('supabase/job_unlocks.sql')
const permanentSql = await read('supabase/job_unlock_permanent.sql')
const durationSql = await read('supabase/job_unlock_24h.sql')
const createFn = await read('supabase/functions/create-job-unlock-order/index.ts')
const verifyFn = await read('supabase/functions/verify-job-unlock/index.ts')
const buyer = await read('src/data/jobUnlock.ts')
const razorpay = await read('src/data/razorpay.ts')
const jobs = await read('src/data/jobs.ts')
const detail = await read('src/components/JobDetail.tsx')
const app = await read('src/App.tsx')

// 1. One job, one verified 24-hour payment -----------------------------------
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

// 5. Verification: signature, exact amount, capture, 24-hour expiry ---------
assert.match(verifyFn, /const JOB_UNLOCK_VALIDITY_HOURS = 24/, 'a new paid unlock lasts 24 hours')
assert.match(verifyFn, /alreadyConfirmed: true/, 'a replayed confirmation is not charged twice')
assert.match(verifyFn, /verifyCheckoutSignature\(secret, orderId, paymentId, signature\)/, 'the signature is verified server-side')
assert.match(verifyFn, /payment\.amount !== JOB_UNLOCK_PRICE_PAISE/, 'a payment of any other amount is refused')
assert.match(verifyFn, /payment\.status !== 'captured'/, 'only a captured payment grants an unlock')
assert.match(verifyFn, /\.eq\('payment_status', 'pending'\)/, 'only a pending row can be paid')
assert.match(verifyFn, /paidAt\.getTime\(\) \+ JOB_UNLOCK_VALIDITY_HOURS \* 60 \* 60 \* 1000/, 'the Edge Function computes exactly 24 hours')
assert.match(verifyFn, /expires_at: expiresAt\.toISOString\(\)/, 'the server stamps the expiry')
assert.match(verifyFn, /LEGACY_PERMANENT_EXPIRY/, 'old permanent unlocks continue to be recognized')
assert.match(verifyFn, /alreadyConfirmed: true/, 'a replayed confirmation returns the same unlock')
assert.match(verifyFn, /\.eq\('user_id', context\.user\.id\)/, 'orders are scoped to their owner')
assert.ok(
  verifyFn.indexOf("payment_status: 'paid'") > verifyFn.indexOf('captured'),
  'the row is marked paid only after capture',
)

// 6. The client never decides price or visibility -----------------------------
assert.match(razorpay, /createJobUnlockOrder\(jobId: string\)/, 'the order call takes only a job id')
assert.doesNotMatch(razorpay, /amount[^s][\s\S]{0,40}planId[\s\S]{0,40}jobId/i, 'no client-side pricing of unlocks')
assert.match(buyer, /export const JOB_UNLOCK_PRICE_RUPEES = 5/, 'the label says ₹5')
assert.match(buyer, /const ANDROID_IN_APP_JOB_UNLOCK = true/, 'the ₹5 unlock is enabled inside the app')
assert.match(buyer, /lowest in-app price in India is ₹10|priced below ₹10 in India/, 'the reason it is not a Play product is written down')
assert.match(buyer, /'Payment cancelled\. Nothing was charged\.'/, 'a dismissed checkout says plainly that nothing was charged')

// 7. The job projection carries the paid window ------------------------------
assert.match(jobs, /jobUnlocked\?: boolean/, 'the job model reads the paid flag')
assert.match(jobs, /jobUnlockExpiresAt\?: string \| null/, 'the job model reads the paid expiry')

// 8. The sheet offers it only where it can be paid ---------------------------
assert.match(detail, /paidUnlock\?: \{ available: boolean; busy: boolean; onBuy: \(job: Job\) => void \}/,
  'the sheet takes the paid unlock as a capability')
assert.match(detail, /paidUnlock\?\.available && \(/, 'the ₹5 button appears only when it is available')
assert.match(detail, /jobUnlockLabel\(\)/, 'the button shows the price and the window')
assert.match(detail, /Full contact unlocked for this job/, 'an active paid unlock is stated on the sheet')
// Both unlock buttons must fit one line on a phone: short labels, no fillers.
assert.match(buyer, /JOB_UNLOCK_VALIDITY_HOURS = 24/, 'single-job validity is centralized at 24 hours')
assert.match(buyer, /Unlock this job \(\$\{JOB_UNLOCK_VALIDITY_HOURS\}h\)/, 'the ₹5 button states its 24-hour validity')
assert.doesNotMatch(buyer, /Unlock this job for good/, 'the permanent-only button text is gone')
assert.match(detail, /🔓 Unlock all jobs/, 'the pass button reads "Unlock all jobs"')
assert.doesNotMatch(detail, /Unlock manager contact/, 'the long pass label is gone')
assert.match(detail, /grid grid-cols-2 gap-2/, 'the ₹5 and pass choices share one row')
assert.match(detail, /₹5 unlocks this job for \$\{JOB_UNLOCK_VALIDITY_HOURS\} hours;/, 'the row clarifies the single-job validity')
assert.match(detail, /onClick=\{onSubscribe\}/, 'the pass button invokes its selection action')
assert.match(app, /onSubscribe=\{openPlansFromJob\}/, 'tapping Unlock all jobs shifts to pass selection')
assert.match(app, /setPassReturnJob\(selectedJob\)[\s\S]{0,100}setSelectedJob\(null\)[\s\S]{0,100}navigate\('plans'\)/, 'pass selection remembers the originating job')
assert.match(app, /nav\.tab === 'plans' && passReturnJob[\s\S]{0,100}setSelectedJob\(passReturnJob\)/, 'Back restores the job detail page')
assert.match(detail, /const fullDetails = Boolean\(job && \(unlocked \|\| paidWindow\.active\)\)/,
  'a paid window reveals the contact block, like a pass would for this sheet')
assert.match(app, /available: paidJobUnlockAvailable\(\) && !unlocked/, 'the app offers the ₹5 unlock wherever it can be paid')
assert.match(app, /await buyJobUnlock\(\{ id: job\.id, title: job\.title \}/, 'the buy runs through the verified helper')
assert.match(app, /const fresh = await loadVisibleJobs\(\)/, 'after paying, the server projection is re-read')

// 9. New unlocks expire after 24 hours; previously paid rows are grandfathered
assert.match(permanentSql, /UPDATE public\.job_unlocks[\s\S]*SET expires_at = 'infinity'/, 'the previous migration preserved paid unlock promises')
assert.match(durationSql, /DROP TRIGGER IF EXISTS job_unlocks_permanent/, 'the permanent trigger is removed')
assert.match(durationSql, /ALTER COLUMN expires_at DROP DEFAULT/, 'new pending rows do not default to infinity')
assert.match(durationSql, /NEW\.expires_at := NEW\.paid_at \+ interval '24 hours'/, 'the database enforces the 24-hour window')
assert.match(durationSql, /OLD\.payment_status IS DISTINCT FROM 'paid'/, 'expiry is set only when a payment first becomes paid')
assert.doesNotMatch(durationSql, /UPDATE public\.job_unlocks\s+SET/, 'existing paid unlocks are not shortened')
assert.match(detail, /₹5 unlocks this job for \$\{JOB_UNLOCK_VALIDITY_HOURS\} hours; a pass unlocks all jobs for its plan validity\./, 'the two access durations are made clear')
assert.match(buyer, /24 hours/, 'the single-job duration is described in the purchase helper')
assert.match(buyer, /succeed\(verified\.expiresAt \?\? 'permanent'\)/, 'verified expiry or legacy permanence is returned to the app')

console.log('job unlock: 24-hour single-job access, legacy paid rows grandfathered, server-priced and verified — passed')
