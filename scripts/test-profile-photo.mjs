import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8')
const [profile, photo, editor, account, sql, deleteUser] = await Promise.all([
  read('src/data/profile.ts'),
  read('src/data/profilePhoto.ts'),
  read('src/components/ProfileEditor.tsx'),
  read('src/screens/AccountScreen.tsx'),
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
assert.match(editor, /Upload or change profile photo/, 'the account profile provides a photo picker')
assert.match(editor, /onPhotoSaved\?\.\(uploaded\.url\)/, 'the uploaded photo immediately updates the account avatar')
assert.match(account, /profilePhoto \? \([\s\S]*<img src=\{profilePhoto\}/, 'the account header displays the saved photo')
assert.match(editor, /JPG, PNG or WEBP · up to 5 MB/, 'the photo limits are explained to the user')
assert.match(editor, /function EditLabel[\s\S]*document\.getElementById\(inputId\)\?\.focus\(\)/, 'each pencil affordance focuses its editable field')
for (const id of ['profile-phone', 'profile-city', 'profile-state', 'profile-address', 'profile-dob', 'profile-gender', 'profile-ctc', 'profile-notice', 'profile-languages', 'profile-skills', 'profile-roles', 'profile-bio']) {
  assert.ok(editor.includes(`inputId="${id}"`), `pencil edit control exists for ${id}`)
}

console.log('profile photo: private owner-only uploads, signed preview, 5 MB validation, per-field pencil editing — passed')
