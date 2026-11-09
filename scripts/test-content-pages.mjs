import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

/**
 * Long text belongs on a page, short decisions belong in a sheet.
 *
 *   * Terms and conditions, About the app/founder and Help each open as their
 *     OWN page: a back arrow in the header, the phone's back button wired to the
 *     same exit, and room to scroll. They used to be paragraphs in a bottom
 *     sheet, where several screens of text had to be read through a small box.
 *   * Dialogs that ask for a decision (delete this vacancy, confirm this plan,
 *     send this email) stay sheets — turning those into pages would be slower.
 */

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8')

const page = await read('src/components/ContentPage.tsx')
const terms = await read('src/screens/TermsPage.tsx')
const about = await read('src/screens/AboutPage.tsx')
const help = await read('src/screens/HelpPage.tsx')
const planInfo = await read('src/screens/PlanInfoPage.tsx')
const plans = await read('src/screens/PlansScreen.tsx')
const account = await read('src/screens/AccountScreen.tsx')
const home = await read('src/screens/HomeScreen.tsx')

// 1. One page shell, shared by every long-text page --------------------------
assert.match(page, /export function ContentPage/, 'there is one page shell')
assert.match(page, /<BackButton onClick=\{onClose\}/, 'every page has a back arrow')
assert.match(page, /useBackHandler\(true, onClose\)/, "the phone's back button leaves the page")
assert.match(page, /--ad-reserve, 0px/, 'the native ads strip still gets its space')
assert.match(page, /overflow-y-auto/, 'a long page scrolls on its own')

// 2. The three long pieces of text all use it --------------------------------
for (const [name, source] of [['terms', terms], ['about', about], ['help', help], ['plan details', planInfo]]) {
  assert.match(source, /<ContentPage/, `${name} opens as a page`)
  assert.doesNotMatch(source, /<Modal/, `${name} is not a sheet`)
  assert.match(source, /onClose=\{[^}]*\}/, `${name} can be left`)
}

// 3. Terms: full text, from the same source the app always used --------------
assert.match(terms, /TERMS_SECTIONS\.map/, 'the terms page renders every section')
assert.match(terms, /TERMS_LAST_UPDATED/, 'the last-updated date is shown')
assert.match(terms, /Back to passes/, 'the page returns to the passes screen')
assert.doesNotMatch(plans, /title="Terms and conditions"/, 'the passes screen no longer opens terms in a sheet')
assert.match(plans, /if \(showTerms\) return <TermsPage onClose=\{\(\) => setShowTerms\(false\)\} \/>/,
  'the terms button swaps in the page')

// 4. About and Help are reachable by a button, not by scrolling paragraphs ---
assert.match(about, /CREATOR\.owner/, 'the about page names who runs the app')
assert.match(about, /CREATOR\.contactEmail/, 'the about page gives a way to make contact')
assert.match(about, /APP_VERSION_LABEL/, 'the about page states the build')
assert.match(help, /UNLOCK_WINDOW_MINUTES/, 'help states the video window from the code constant')
assert.match(help, /JOB_UNLOCK_PRICE_RUPEES/, 'help states the per-job price from the code constant')
assert.match(help, /JOB_UNLOCK_MINUTES/, 'help states the per-job window from the code constant')

assert.match(account, /import \{ AboutPage \}/, 'Account can open About')
assert.match(account, /import \{ HelpPage \}/, 'Account can open Help')
assert.match(account, /if \(infoPage === 'about'\) return <AboutPage onClose=\{\(\) => setInfoPage\(null\)\} \/>/,
  "Account's About button opens the page")
assert.match(account, /if \(infoPage === 'help'\) return <HelpPage onClose=\{\(\) => setInfoPage\(null\)\} \/>/,
  "Account's Help button opens the page")
assert.match(account, /About MedRep Connect Pro/, 'the About button has a label')
assert.match(account, /Help &amp; how it works/, 'the Help button has a label')
assert.match(home, /Read more about the app/, 'the founder card links to the about page')
assert.match(home, /if \(aboutOpen\) return <AboutPage onClose=\{\(\) => setAboutOpen\(false\)\} \/>/,
  "Home's read-more opens the page")

// 4b. The passes page sells nothing on the side: the three reading cards that
// used to sit under the price boxes (benefits, how payment works, standard
// terms) are one button away, on a page.
assert.doesNotMatch(plans, /<div className="text-sm font-bold text-slate-900 mb-1">Plan benefits<\/div>/,
  'plan benefits are not pasted under the boxes')
assert.doesNotMatch(plans, /Instructions &amp; standard terms/, 'the standard terms are not pasted under the boxes')
assert.match(plans, /Plan benefits, payments &amp; terms/, 'one compact line names the reading')
assert.match(plans, /if \(showInfo\) return <PlanInfoPage inApp=\{inApp\} onClose=\{\(\) => setShowInfo\(false\)\} \/>/,
  'the Read details button opens the plan info page')
assert.match(planInfo, /Plan benefits/, 'the plan info page carries the benefits')
assert.match(planInfo, /How payment works/, 'the plan info page carries the payment description')
assert.match(planInfo, /Instructions & standard terms/, 'the plan info page carries the standard terms')
assert.match(planInfo, /TermsPage onClose=\{\(\) => setShowTerms\(false\)\} backLabel="Back to plan details"/,
  'full terms are one more step, and come back here')
assert.match(terms, /backLabel = 'Back to passes'/, 'the terms page adapts its way back')

// 5. Decision dialogs stay sheets -------------------------------------------
assert.match(plans, /<Modal open=\{showCheckout\}/, 'confirming a plan is still a sheet')
const admin = await read('src/screens/AdminScreen.tsx')
assert.match(admin, /title="Delete vacancy"/, 'deleting a vacancy is still a sheet')
const detail = await read('src/components/JobDetail.tsx')
assert.match(detail, /<Modal open=\{!!job\}/, 'a vacancy still opens as a sheet')

console.log('content pages: terms, about and help open as their own pages with a back arrow; decisions stay sheets — passed')
