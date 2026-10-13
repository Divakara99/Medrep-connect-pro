import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'

/**
 * The shared administrator rules used by every admin Edge Function
 * (supabase/functions/_shared/http.ts — the shipping source, transpiled here).
 *
 * These rules are the reason the admin console can open without a six-digit code
 * while the database still refuses a password-only session, so they are pinned:
 *   - code ON  : password-only (aal1) is denied, verified (aal2) is allowed
 *   - code OFF : both are allowed (the owner switched it off on purpose)
 *   - unknown  : denied — the switch fails safe
 *   - roles    : app_metadata.role / is_admin only, never user_metadata
 */
const source = await readFile(new URL('../supabase/functions/_shared/http.ts', import.meta.url), 'utf8')
const javascript = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  fileName: 'http.ts',
}).outputText
const file = join(process.env.TMPDIR || '/tmp', `mrc-http-${process.pid}.mjs`)
await writeFile(file, javascript)
const { adminAccessAllowed, isAdmin, isVacancyEditor, isUuid, jsonResponse } = await import(pathToFileURL(file).href)

// ---- The sign-in code switch ----
assert.equal(adminAccessAllowed(true, true), true, 'verified session with the code ON')
assert.equal(adminAccessAllowed(false, true), false, 'password-only session with the code ON must be denied')
assert.equal(adminAccessAllowed(false, false), true, 'password-only session with the code OFF is allowed')
assert.equal(adminAccessAllowed(true, false), true, 'verified session with the code OFF stays allowed')
assert.equal(adminAccessAllowed(false, undefined), false, 'an unreadable switch must deny aal1')
assert.equal(adminAccessAllowed(false, null), false)
assert.equal(adminAccessAllowed(false, 0), false, 'only an explicit false turns the requirement off')
assert.equal(adminAccessAllowed(false, 'false'), false, 'a string never turns the requirement off')

// ---- Role parsing (trusted app_metadata only) ----
assert.equal(isAdmin({ role: 'admin' }), true)
assert.equal(isAdmin({ role: 'vacancy_editor' }), false, 'the team role is not an administrator')
assert.equal(isAdmin({ is_admin: true }), true)
assert.equal(isAdmin({ is_admin: 'true' }), true)
assert.equal(isAdmin({ is_admin: 'false' }), false)
assert.equal(isAdmin({ role: 'user' }), false)
assert.equal(isAdmin(undefined), false)
assert.equal(isAdmin(null), false)
assert.equal(isVacancyEditor({ role: 'vacancy_editor' }), true)
assert.equal(isVacancyEditor({ role: 'admin' }), false)
assert.equal(isVacancyEditor(undefined), false)

// ---- Small helpers the push function relies on ----
assert.equal(isUuid('11111111-1111-4111-8111-111111111111'), true)
assert.equal(isUuid('not-a-uuid'), false)
assert.equal(jsonResponse({ ok: true }).status, 200)
assert.equal(jsonResponse({ error: 'nope' }, 403).status, 403)

console.log('admin access rules: switch ON/OFF, fail-safe default and trusted roles passed')
