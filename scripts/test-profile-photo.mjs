import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8')
const [profile, photo, editor, account, app, sql, deleteUser] = await Promise.all([
  read('src/data/profile.ts'),
  read('src/data/profilePhoto.ts'),
  read('src/components/ProfileEditor.tsx'),
  read('src/screens/AccountScreen.tsx'),
  read('src/App.tsx'),
  read('supabase/profile_photos.sql'),
  read('supabase/functions/admin-delete-user/index.ts'),
])

assert.match(profile, /photoPath\?: string/, 'the profile stores only the private object path')
assert.match(photo, /MAX_PHOTO_BYTES = 5 \* 1024 \* 1024/, 'photo uploads are capped at 5 MB')
assert.match(photo, /image\/jpeg[\s\S]*image\/png[\s\S]*image\/webp/, 'only common web photo formats are accepted')
assert.match(photo, /\$\{user\.id\}\/\$\{crypto\.randomUUID\(\)\}/, 'objects are namespaced to the signed-in user')
assert.match(photo, /createSignedUrl\(path, SIGNED_URL_SECONDS\)/, 'previews use short-lived signed URLs')
assert.match(sql, /VALUES \([\s\S]*'profile-photos'[\s\S]*false[\s\S]*5242880/, 'the bucket is private and server-limited')
assert.match(sql, /profile_photos_read_own[\s\S]*storage\.foldername\(name\).*auth\.uid\(\)/, 'reads are restricted to the owner folder')
assert.match(sql, /profile_photos_insert_own[\s\S]*storage\.foldername\(name\).*auth\.uid\(\)/, 'uploads are restricted to the owner folder')
assert.match(deleteUser, /\.from\('profile-photos'\)[\s\S]*\.list\(targetId[\s\S]*\.remove\(photoPaths\)/, 'admin account deletion cleans up private profile photo objects')
assert.match(account, /aria-label=\{photoBusy \? 'Uploading profile picture' : 'Change profile picture'\}/, 'the account identity avatar is the profile picture picker')
assert.match(account, /if \(taps\.count >= 5\)[\s\S]*setAdsDebugOpen\(true\)/, 'five version taps open the diagnostics panel')
assert.match(account, /id="ad-diagnostics-panel"/, 'the diagnostics panel has a scroll target')
assert.match(account, /getElementById\('ad-diagnostics-panel'\)[\s\S]*scrollIntoView/, 'opening diagnostics scrolls the panel into view')
assert.match(account, /setTimeout\(\(\) => \{ taps\.count = 0 \}, 5000\)/, 'the tap gesture has a forgiving five-second window')
assert.doesNotMatch(account, /function onVersionTap\(\) \{\s*if \(!isAndroidApp\(\)\) return/, 'the tap works in the browser preview as well as Android')
assert.match(account, /Browser preview can confirm this panel opens/, 'browser diagnostics clearly explain that live AdMob controls are Android-only')
assert.match(account, /<img src=\{visiblePhotoUrl\} alt=""/, 'the saved profile picture appears in the account identity avatar')
assert.match(account, /text-lg font-extrabold tracking-tight text-slate-900">\{user\.name\}/, 'the profile picture sits with the signed-in name')
assert.doesNotMatch(editor, /Profile photo|Upload or change profile photo|photoInput/, 'the profile editor has no separate profile photo option')
assert.doesNotMatch(editor, /\{name\}|Profile<\/div>/, 'the profile editor does not repeat the account name')
assert.match(app, /label: 'Account & Profile'[\s\S]*whitespace-nowrap/, 'Account & Profile stays on one line in the menu')
assert.match(account, /accept="image\/jpeg,image\/png,image\/webp"/, 'the account picture picker accepts only supported image formats')
assert.match(editor, /function EditLabel[\s\S]*document\.getElementById\(inputId\)\?\.focus\(\)/, 'each pencil affordance focuses its editable field')
for (const id of ['profile-phone', 'profile-city', 'profile-state', 'profile-address', 'profile-dob', 'profile-gender', 'profile-ctc', 'profile-notice', 'profile-languages', 'profile-skills', 'profile-roles', 'profile-bio']) {
  assert.ok(editor.includes(`inputId="${id}"`), `pencil edit control exists for ${id}`)
}

console.log('profile photo: private owner-only uploads, one account name, 5 MB validation, per-field pencil editing — passed')
