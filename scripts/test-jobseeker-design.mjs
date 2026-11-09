import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

/**
 * The job-seeker experience, in two rules:
 *
 *   1. Job hunting is the subject. Passes are a utility at the bottom of the
 *      menu, never a badge, a banner or a highlighted button on the screens a
 *      candidate lives in.
 *   2. Every screen is built from the same surface language (src/index.css +
 *      src/components/ui.tsx), so the product reads as one design.
 */

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8')

const app = await read('src/App.tsx')
const home = await read('src/screens/HomeScreen.tsx')
const priority = await read('src/screens/PriorityScreen.tsx')
const detail = await read('src/components/JobDetail.tsx')
const card = await read('src/components/JobCard.tsx')
const account = await read('src/screens/AccountScreen.tsx')
const css = await read('src/index.css')
const ui = await read('src/components/ui.tsx')

// 1. No plan promotion in the job-seeker menu ---------------------------------
const menuStart = app.indexOf('const USER_MENU_ITEMS')
const menu = app.slice(menuStart, app.indexOf('\n]', menuStart))
assert.doesNotMatch(menu, /💎/, 'the menu no longer brands passes with a gem')
assert.doesNotMatch(menu, /label: 'Plans'/, 'passes are not a headline menu entry')
assert.match(menu, /label: 'Passes & pricing'/, 'passes stay reachable under a plain label')
assert.equal(
  menu.trim().split('\n').filter((line) => line.includes("{ id: '")).at(-1)?.includes("'plans'"),
  true,
  'passes sit last in the menu, after the job-hunting pages',
)

// 2. No plan pitch on the feed, the detail sheet or the job card ---------------
assert.doesNotMatch(home, /PlansScreen|onSubscribe|Upgrade|💎|Subscribe to/, 'the feed never sells a pass')
assert.doesNotMatch(priority, /onSubscribe|Upgrade|💎|Subscribe to/, 'priority jobs never sell a pass')
assert.doesNotMatch(detail, /variant="accent"[\s\S]{0,120}onSubscribe/, 'the detail sheet keeps passes quiet')
assert.doesNotMatch(detail, /Subscribe to unlock/, 'the detail sheet does not push a subscription')
assert.match(detail, /Unlock manager contact/, 'the detail sheet offers the contact plainly')
assert.doesNotMatch(card, /Subscribe to unlock/, 'the job card does not push a subscription')
assert.match(card, /Contact locked/, 'the job card states the lock without selling')

// 2b. The passes page itself is a plain list, not a shop window ---------------
const plans = await read('src/screens/PlansScreen.tsx')
assert.doesNotMatch(plans, /Most popular/, 'passes carry no "most popular" badge')
assert.doesNotMatch(plans, /hero-mesh/, 'the passes page opens with text, not a promo hero')
assert.doesNotMatch(plans, /ring-2 ring-brand-600 ring-offset-2/, 'a pass is not highlighted just for existing')
assert.match(plans, /Choose a pass/, 'passes are one plain list')
assert.match(plans, /One payment · no auto-renew/, 'the list states the terms in one line')

// Each pass is its own plain box: a bordered card in a grid, not a divided list.
assert.match(plans, /grid grid-cols-2 gap-3 p-3 sm:grid-cols-3/, 'passes sit in a simple box grid')
assert.match(plans, /flex cursor-pointer flex-col rounded-2xl border p-3/, 'every pass is a plain bordered box')
assert.doesNotMatch(plans, /divide-y divide-slate-100/, 'the single divided list is gone')
// The whole box is the tap target — not just the small button — but tapping a
// box that is already selected never starts a payment.
assert.match(plans, /role="button"[\s\S]{0,220}aria-pressed=\{isSelected\}/, 'each pass box is itself a button')
assert.match(plans, /onClick=\{\(\) => \{ if \(!isSelected\) selectPlan\(plan\.id\) \}\}/, 'tapping anywhere on a box selects that pass')
assert.match(plans, /if \(event\.key !== 'Enter' && event\.key !== ' '\) return/, 'the box keyboard-selects with Enter and Space')
assert.match(plans, /event\.stopPropagation\(\)/, 'the Select button does not double-fire through the box')

// 3. The account page names what a pass is for, quietly -----------------------
assert.match(account, /Passes &amp; pricing/, 'passes are one tap away in Account')
assert.match(account, /A pass is only needed for the manager/, 'the account page explains a pass before pricing')
assert.match(account, /onViewPasses/, 'Account can open the passes page')

// 4. One shared surface language ---------------------------------------------
for (const utility of ['hero-mesh', 'glass-bar', 'gradient-text', 'hairline', 'lift']) {
  assert.match(css, new RegExp(`\\.${utility}\\b`), `${utility} is defined once, in src/index.css`)
}
assert.match(css, /background-clip: text/, 'the gradient wordmark survives on every browser')
assert.match(css, /prefers-reduced-motion/, 'motion is still reduced when the device asks for it')
assert.match(ui, /hero-mesh|rounded-3xl/, 'the shared card sets the surface radius')
assert.match(ui, /focus:ring-4/, 'fields keep a visible focus ring')
assert.match(ui, /--ad-reserve, 0px/, 'sheets still clear the native ads banner')

// 5. Screens use the hero block rather than ad-hoc gradients ------------------
assert.match(home, /className="hero-mesh/, 'the feed opens with the shared hero')
assert.match(priority, /from-amber-300 via-amber-400 to-orange-500/, 'priority keeps its own warm hero')
assert.match(priority, /rounded-\[28px\]/, 'both heroes use the same radius')

console.log('job-seeker design: passes are plain and last, no plan promotion, one shared surface language, heroes on both feeds — passed')
