// Guards the promise that app data lives in Supabase, not in the browser.
//
// The only thing the browser may keep is the Supabase sign-in session
// (`mrc_supabase_auth_v1`), so a reload does not sign the user out. Everything
// else — profiles, notifications, read state, account lists, payments, resumes,
// support requests — is read from the server on demand and held in memory for
// the session only.
//
// Run with: node scripts/test-no-local-cache.mjs

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

let failures = 0
function check(name, condition, detail = '') {
  if (condition) {
    console.log(`  ok  ${name}`)
  } else {
    failures += 1
    console.error(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

const read = (path) => readFileSync(path, 'utf8')

function walk(dir, files = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, files)
    else if (/\.(ts|tsx)$/.test(entry)) files.push(full)
  }
  return files
}

const sources = walk('src')

// ---------- 1. Nothing is written to browser storage ----------

const dataFiles = sources.filter((file) => !file.endsWith('src/data/storage.ts'))

// Storage writes used to go through `write(key, value)` from storage.ts, and a
// few modules kept their own copy. Neither is allowed any more: the only
// persisted browser value is the Supabase session below.
const writers = dataFiles.filter((file) => {
  const text = read(file)
  if (/import\s*\{[^}]*\bwrite\b[^}]*\}\s*from\s*'(\.\.?\/)+data\/storage'/.test(text)) return true
  if (/import\s*\{[^}]*\bwrite\b[^}]*\}\s*from\s*'\.\/storage'/.test(text)) return true
  return text.split('\n').some((line) => line.includes('localStorage.setItem') && !/^\s*(\/\/|\*)/.test(line))
})
check(
  'no module writes app data to browser storage',
  writers.length === 0,
  writers.join(', '),
)

// A module may keep an in-memory copy, but it must not be the storage helper.
const sessionOnly = read('src/data/notifications.ts')
check(
  'the notification session copy is a Map, not storage',
  /const session = new Map<string, unknown>\(\)/.test(sessionOnly),
)

// ---------- 2. The Supabase client is the only storage adapter ----------

const supabase = read('src/data/supabase.ts')
check(
  'the Supabase session is the only persisted browser value',
  /storageKey:\s*'mrc_supabase_auth_v1'/.test(supabase),
  'storageKey missing from the Supabase client',
)
check(
  'the client does not fall back to the default storage key',
  !/persistSession:\s*false/.test(supabase),
  'session persistence was switched off; users would be signed out on reload',
)

const storage = read('src/data/storage.ts')
check(
  'the storage helper writes nothing but plain key/value pairs',
  /localStorage\.setItem/.test(storage) && !/indexedDB/.test(storage),
)

// ---------- 3. Profiles live online ----------

const profile = read('src/data/profile.ts')
check('a profile is saved with an upsert to public.job_profiles', /from\('job_profiles'\)[\s\S]*?upsert\(/.test(profile))
check('a profile is read from public.job_profiles', /from\('job_profiles'\)[\s\S]*?select\('data'\)/.test(profile))
check('the old browser profile key is deleted, never read', /remove\(LEGACY_PROFILES_KEY\)/.test(profile))
check('a failed online save is reported, not swallowed', /throw new Error\('Your profile could not be saved online/.test(profile))

// ---------- 4. Notifications and read state live online ----------

const notifications = read('src/data/notifications.ts')
check(
  'the notification feed comes from list_visible_notifications',
  /rpc\('list_visible_notifications'\)/.test(notifications),
)
check(
  'notification state is stored per account',
  /from\(STATE_TABLE\)/.test(notifications) && /notification_state/.test(notifications),
)
check(
  'read state is written back to the server',
  /saveAccountState\(\{ read_since/.test(notifications),
)
check(
  'the browser notification keys are deleted, not read',
  /remove\(NOTIF_KEY\)/.test(notifications) && /remove\('mrc_notif_read_v1'\)/.test(notifications),
)

// ---------- 5. The admin account list is session-only ----------

const auth = read('src/data/auth.ts')
check(
  'the admin account list is held in memory',
  /let adminUsersCache: User\[\] = \[\]/.test(auth) && !/mrc_admin_users_cache_v1['"`]\s*,/.test(auth),
)

// ---------- 6. No screen reads browser storage directly ----------

const readers = dataFiles.filter((file) => {
  if (file.endsWith('src/data/resume.ts')) return false // sweeps old resume blobs to delete them
  const text = read(file)
  return text.split('\n').some((line) => {
    if (!/localStorage\.(getItem|length|key)\b/.test(line)) return false
    return !/^\s*(\/\/|\*|\/\*)/.test(line)
  })
})
check(
  'no screen reads localStorage directly',
  readers.length === 0,
  readers.join(', '),
)

// Purges of the old keys are still allowed, and expected: they are how a device
// that ran an older build stops keeping company names and profiles offline.
const purged = dataFiles.filter((file) => /remove\(|removeItem\(/.test(read(file)))
check('old browser keys are purged on start-up or sign-in', purged.length >= 4, purged.join(', '))

// ---------- 7. The SQL the user must run is checked in ----------

const sql = read('supabase/job_profiles.sql')
check('job_profiles has row-level security', /ALTER TABLE public\.job_profiles ENABLE ROW LEVEL SECURITY/.test(sql))
check('job_profiles is keyed by the signed-in user', /user_id = \(SELECT auth\.uid\(\)\)/.test(sql))
check('job_profiles is limited to own-row writes', /job_profiles_update_own/.test(sql))
check('service_role can maintain job_profiles', /GRANT ALL ON public\.job_profiles TO service_role/.test(sql))

const stateSql = read('supabase/notification_state.sql')
check('notification_state has row-level security', /ENABLE ROW LEVEL SECURITY/.test(stateSql))
check('notification_state is limited to own-row writes', /notification_state_update_own/.test(stateSql))

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`)
  process.exit(1)
}
console.log('\nBrowser storage holds only the sign-in session.')
