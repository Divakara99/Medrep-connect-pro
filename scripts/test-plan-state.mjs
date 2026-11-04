import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'

/**
 * Plans page: active vs expired (src/data/planState.ts — the shipping source).
 *
 * The reported bug this pins: a pass whose days had run out still carried the
 * green "✓ Active" badge while every contact detail was locked again. The rule
 * now is that "Active" and "unlocked" can never disagree.
 */
const source = await readFile(new URL('../src/data/planState.ts', import.meta.url), 'utf8')
const javascript = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  fileName: 'planState.ts',
}).outputText
const file = join(process.env.TMPDIR || '/tmp', `mrc-planstate-${process.pid}.mjs`)
await writeFile(file, javascript)
const { readPlanState } = await import(pathToFileURL(file).href)

const DAY = 86_400_000
const NOW = 1_800_000_000_000

const plan = (planId, expiresAt, extra = {}) => ({
  planId,
  status: 'success',
  createdAt: expiresAt - 30 * DAY,
  expiresAt,
  ...extra,
})

// 1. A pass that still covers the subscription is the active one.
{
  const state = readPlanState([plan('p30', NOW + 5 * DAY)], { unlocked: true, now: NOW })
  assert.equal(state.activePlanId, 'p30', 'future expiry must be active')
  assert.equal(state.expiredPlanId, null, 'a live pass is never expired')
  assert.equal(state.activeUntil, NOW + 5 * DAY)
  assert.equal(state.suggestedPlanId, 'p30')
}

// 2. THE BUG: expiry in the past is Expired, not Active — even though the row
//    is still a successful payment.
{
  const state = readPlanState([plan('p30', NOW - 2 * DAY)], { unlocked: false, now: NOW })
  assert.equal(state.activePlanId, null, 'an expired pass must not be labelled Active')
  assert.equal(state.expiredPlanId, 'p30', 'the expired pass is named for the renewal')
  assert.equal(state.expiredAt, NOW - 2 * DAY)
  assert.equal(state.suggestedPlanId, 'p30', 'renewal preselects the expired plan')
  assert.ok(state.purchased.has('p30'), 'it is still shown as bought')
}

// 3. The exact boundary: the second access ends, the plan is expired.
{
  assert.equal(readPlanState([plan('p5', NOW)], { unlocked: false, now: NOW }).activePlanId, null)
  assert.equal(readPlanState([plan('p5', NOW + 1)], { unlocked: true, now: NOW }).activePlanId, 'p5')
}

// 4. A renewal that extends an expired pass makes it active again, and only the
//    newest expiry counts.
{
  const payments = [plan('p30', NOW - 2 * DAY), plan('p30', NOW + 30 * DAY)]
  const state = readPlanState(payments, { unlocked: true, now: NOW })
  assert.equal(state.activePlanId, 'p30', 'the extended pass is active')
  assert.equal(state.activeUntil, NOW + 30 * DAY, 'the later expiry wins')
  assert.equal(state.purchased.get('p30'), NOW + 30 * DAY)
}

// 5. Pending / failed / rejected rows never unlock anything.
{
  const state = readPlanState(
    [
      { planId: 'p90', status: 'pending', createdAt: NOW, expiresAt: NOW + 90 * DAY },
      { planId: 'p90', status: 'failed', createdAt: NOW, expiresAt: NOW + 90 * DAY },
      { planId: 'p90', status: 'rejected', createdAt: NOW, expiresAt: NOW + 90 * DAY },
    ],
    { unlocked: false, now: NOW },
  )
  assert.equal(state.activePlanId, null)
  assert.equal(state.expiredPlanId, null, 'an unpaid order is neither active nor expired')
  assert.equal(state.purchased.size, 0, 'only verified payments are recorded as bought')
  assert.equal(state.suggestedPlanId, null)
}

// 6. The seconds right after a purchase: the checkout confirmed the plan but
//    the ledger read has not come back yet, so the session's plan is used.
{
  const state = readPlanState([], { unlocked: true, purchasedPlanId: 'p15', now: NOW })
  assert.equal(state.activePlanId, 'p15', 'a just-confirmed plan is active without a ledger row')
  // ...but not for a signed-out-of-plan account: no paid access, no Active.
  assert.equal(readPlanState([], { unlocked: false, purchasedPlanId: 'p15', now: NOW }).activePlanId, null)
}

// 7. The server expiry is authoritative when it is later than the ledger row
//    (an admin extension, or a renewal recorded elsewhere).
{
  const state = readPlanState([plan('p10', NOW + 3 * DAY)], {
    unlocked: true,
    subscribedUntil: NOW + 40 * DAY,
    now: NOW,
  })
  assert.equal(state.activePlanId, 'p10')
  assert.equal(state.activeUntil, NOW + 40 * DAY, 'the later of the two expiries is shown')
}

// 8. Two plans: the one still covering wins over a newer expired one.
{
  const state = readPlanState([plan('p90', NOW + 10 * DAY), plan('p5', NOW - 1 * DAY)], {
    unlocked: true,
    now: NOW,
  })
  assert.equal(state.activePlanId, 'p90')
  assert.equal(state.expiredPlanId, null)
  assert.equal(state.purchased.get('p5'), NOW - 1 * DAY, 'old purchases stay in the history badge')
}

console.log('plan state: expired passes are never Active, renewals re-activate passed')
