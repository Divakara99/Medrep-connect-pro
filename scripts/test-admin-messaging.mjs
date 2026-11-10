import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { MAX_ADDRESS_LENGTH, addressLine, addressProblem, addressSearchText } from '../src/data/userAddress.ts'

/**
 * What the administrator can do from the console about one person:
 *
 *   * see the user's address in the Users table (and find a user by it),
 *   * send an announcement to everyone or to one account only,
 *   * create a vacancy-team login with the same 6-character rule as every
 *     other account,
 *   * and reach the server even when the browser's session token was stale.
 */

// 1. The address line ---------------------------------------------------------
assert.equal(addressLine({}), '', 'nothing known is an empty line, never "undefined"')
assert.equal(addressLine({ address: '  12 MG Road, Hubballi  ' }), '12 MG Road, Hubballi', 'the full address is trimmed')
assert.equal(addressLine({ city: 'Hubballi', state: 'Karnataka' }), 'Hubballi, Karnataka', 'a short address still reads well')
assert.equal(addressLine({ address: '12 MG Road', city: 'Hubballi', state: 'Karnataka' }), '12 MG Road — Hubballi, Karnataka', 'city and state follow the street')
assert.equal(addressLine({ address: '12 MG Road, Hubballi', city: 'Hubballi', state: 'Karnataka' }), '12 MG Road, Hubballi — Karnataka', 'the city is never repeated')
assert.equal(addressLine({ address: '12 MG Road, Hubballi, Karnataka', city: 'Hubballi', state: 'Karnataka' }), '12 MG Road, Hubballi, Karnataka', 'nothing is repeated when the address is complete')
assert.equal(addressLine({ address: null, city: null, state: 'Kerala' }), 'Kerala', 'nulls are ignored')
assert.equal(addressSearchText({ address: '12 MG Road', city: 'Hubballi', state: 'Karnataka' }), '12 MG Road Hubballi Karnataka', 'the search covers every part')
assert.equal(addressProblem('x'.repeat(MAX_ADDRESS_LENGTH)), null, 'the limit itself is allowed')
assert.match(addressProblem('x'.repeat(MAX_ADDRESS_LENGTH + 1)) ?? '', /under 200/, 'longer than the limit is refused')

// 2. The profile keeps it -----------------------------------------------------
const profile = await readFile(new URL('../src/data/profile.ts', import.meta.url), 'utf8')
assert.match(profile, /address\?: string/, 'the profile has an address field')
assert.match(profile, /data: next/, 'and it is saved with the rest of the profile')

const editor = await readFile(new URL('../src/components/ProfileEditor.tsx', import.meta.url), 'utf8')
assert.match(editor, /Address \(optional\)/, 'the job seeker can type it')
assert.match(editor, /MAX_ADDRESS_LENGTH/, 'with the same cap the admin list assumes')

// 3. The admin sees it --------------------------------------------------------
const auth = await readFile(new URL('../src/data/auth.ts', import.meta.url), 'utf8')
assert.match(auth, /from\('job_profiles'\)/, 'the admin reads the profile row')
assert.match(auth, /address: places\.get\(row\.user_id\)\?\.address/, 'and maps the address onto the account')

const admin = await readFile(new URL('../src/screens/AdminScreen.tsx', import.meta.url), 'utf8')
assert.match(admin, /<th className="px-3 py-2">Address<\/th>/, 'the Users table has an Address column')
assert.match(admin, /addressLine\(u\)/, 'each row shows the one-line address')
assert.match(admin, /addressSearchText\(u\)/, 'and the search finds a user by address')

// 4. Announcements: everyone, or one person -----------------------------------
assert.match(admin, /sendAnnouncementTo/, 'the console can send to a single account')
assert.match(admin, /One user/, 'and offers that choice')
assert.match(admin, /Send to \$\{person\.name\}/, 'the button names the recipient, so nobody is surprised')

const notifications = await readFile(new URL('../src/data/notifications.ts', import.meta.url), 'utf8')
const toStart = notifications.indexOf('export async function sendAnnouncementTo')
assert.ok(toStart > 0, 'sendAnnouncementTo exists')
const toBlock = notifications.slice(toStart, notifications.indexOf('export async function publish', toStart))
assert.match(toBlock, /privateNotificationTarget\(email\)/, 'the recipient must be a valid address')
assert.match(toBlock, /\{ target \}|target:/, 'the notice is addressed to that one account')
assert.doesNotMatch(toBlock, /'all'/, 'never silently to everyone')

// The server only pushes to subscriptions whose email is in the target list.
const sendPush = await readFile(new URL('../supabase/functions/send-push/index.ts', import.meta.url), 'utf8')
assert.match(sendPush, /\.in\('email', notification\.target\)/, 'the push step honours the audience')

// 5. Team login password: 6, like every other account -------------------------
const teamAdmin = await readFile(new URL('../src/components/VacancyTeamAdmin.tsx', import.meta.url), 'utf8')
assert.match(teamAdmin, /Password \(6\+ characters\)/, 'the create form asks for 6')
assert.match(teamAdmin, /New password \(6\+ characters\)/, 'the reset form asks for 6')
assert.doesNotMatch(teamAdmin, /12\+ characters/, 'the old 12-character wording is gone')
const teamFunction = await readFile(new URL('../supabase/functions/admin-manage-employees/index.ts', import.meta.url), 'utf8')
assert.match(teamFunction, /password\.length < 6/, 'the server enforces the same 6')

// 6. A stale session is refreshed, not blamed on the admin --------------------
const supabaseModule = await readFile(new URL('../src/data/supabase.ts', import.meta.url), 'utf8')
const callStart = supabaseModule.indexOf('export async function callEdgeFunction')
const callBlock = supabaseModule.slice(callStart)
assert.ok(callStart > 0, 'callEdgeFunction exists')
assert.match(callBlock, /refreshSession\(\)/, 'an expired session is refreshed')
assert.match(callBlock, /Authorization: `Bearer \$\{token\}`/, 'the call carries the live token')
assert.match(callBlock, /session is invalid or expired/, 'and the retry is limited to that one error')
assert.match(callBlock, /attempt < 2/, 'exactly one retry')

const teamData = await readFile(new URL('../src/data/vacancyTeam.ts', import.meta.url), 'utf8')
assert.match(teamData, /callEdgeFunction\('admin-manage-employees'/, 'the team console goes through it')
assert.match(auth, /callEdgeFunction\('admin-delete-user'/, 'delete-account does too')

console.log('admin messaging: address visible, one-user announcements, 6-character team password, stale session recovered — passed')
