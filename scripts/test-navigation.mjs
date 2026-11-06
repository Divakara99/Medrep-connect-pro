import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

/**
 * Getting back out of a page.
 *
 * Every section is reached from the header menu — the app has no bottom bar (the
 * old BottomNav was never rendered and has been deleted). The hardware back
 * gesture already walked the app's own tab stack, but there was no visible
 * control, so on a tablet there was no on-screen way back.
 */
const app = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8')
const notifications = await readFile(new URL('../src/components/NotificationsPanel.tsx', import.meta.url), 'utf8')

// 1. The header shows a back arrow whenever there is a page to go back to, and
//    it uses the same handler as the hardware gesture.
assert.match(app, /nav\.stack\.length > 0/, 'the header renders a back control only when a page can be popped')
assert.match(app, /onClick=\{goBackInApp\}/, 'the on-screen back control steps the same stack the gesture does')
assert.match(app, /aria-label="Back"/, 'the back control is labelled for screen readers')

// 2. The tab stack and the gesture must stay pointed at the same state, or the
//    arrow and the hardware button would disagree.
assert.match(app, /const goBackInApp = useCallback\(\(\) => \{[\s\S]*?setNav\(/, 'goBackInApp mutates the shared tab stack')
assert.match(app, /useBackHandler\(view === 'user', goBackInApp\)/, 'the hardware back gesture uses that same stack')

// 3. Notifications opens straight from the menu, so it carries the shared back
//    control rather than only an × in the corner.
assert.match(notifications, /<Modal open=\{open\} onClose=\{onClose\} onBack=\{onClose\}/, 'the notifications sheet has a Back control')

// 4. Pages that are pushed over another page must keep their own back control.
const applications = await readFile(new URL('../src/screens/ApplicationsScreen.tsx', import.meta.url), 'utf8')
assert.match(applications, /<BackButton onClick=\{onClose\}/, 'the applications page has a Back control')

console.log('navigation: header back arrow, shared tab stack, sheet and page back controls — passed')
