import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

/**
 * Undo has to undo. The admin panel offered an Undo button for deletes whose
 * tombstone no longer carried the vacancy, so pressing it only ever produced an
 * error message. Four things are pinned here:
 *
 *   * the database keeps the whole row when a vacancy is deleted, whatever
 *     writes the tombstone;
 *   * restoring is one checked, audited server call — not a client update;
 *   * the admin panel reads the restore back into both lists;
 *   * tombstones that lost their body say so, and offer the form instead.
 */

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8')

const sql = await read('supabase/vacancy_restore.sql')
const jobs = await read('src/data/jobs.ts')
const admin = await read('src/screens/AdminScreen.tsx')
const form = await read('src/components/VacancyForm.tsx')
const copy = await read('scripts/copy-sql.mjs')

// 1. The tombstone keeps the row ---------------------------------------------
assert.match(sql, /CREATE OR REPLACE FUNCTION public\.vacancies_keep_body\(\)/,
  'a trigger function keeps the vacancy body')
assert.match(sql, /NEW\.data := OLD\.data \|\| NEW\.data/,
  'the old body is merged under the new tombstone fields')
assert.match(sql, /BEFORE UPDATE ON public\.vacancies/, 'it runs before the row is written')
assert.match(sql, /CREATE OR REPLACE FUNCTION public\.employee_delete_vacancy/,
  'the team delete is updated too')
assert.match(sql, /SET data = current_row\.data \|\| jsonb_build_object/,
  'the team delete merges the flags instead of rebuilding the row')
assert.doesNotMatch(sql, /SET data = jsonb_build_object\(\s*'deleted', true,/, 'the team delete no longer drops the body')

// 2. Restore is a checked, audited server call -------------------------------
assert.match(sql, /CREATE OR REPLACE FUNCTION public\.restore_vacancy\(p_id text\)/, 'there is a restore function')
assert.match(sql, /public\.is_app_admin\(\) OR public\.is_vacancy_editor\(\)/, 'only an admin or the vacancy team may restore')
assert.match(sql, /- 'deleted' - 'deletedAt' - 'deleteReason' - 'deletedBy'/, 'restoring clears every tombstone flag')
assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.restore_vacancy\(text\) TO authenticated/, 'signed-in admins may call it')
assert.match(sql, /REVOKE ALL ON FUNCTION public\.restore_vacancy\(text\) FROM PUBLIC, anon/, 'nobody anonymous may')
assert.match(sql, /'restored'/, 'the activity log records a restore')
assert.match(sql, /action IN \('added', 'deleted', 'restored'\)/, 'the audit action check accepts it')
assert.match(sql, /cannot be restored\. Post it again instead\./, 'a body-less tombstone is refused with a reason')

// 3. The client uses it ------------------------------------------------------
assert.match(jobs, /export async function restoreJob\(id: string\): Promise<string>/, 'restoreJob returns what it restored')
assert.match(jobs, /supabase\.rpc\('restore_vacancy', \{ p_id: id \}\)/, 'it calls the server function')
assert.match(jobs, /missingFunction/, 'a database without the migration still undoes the delete')
assert.match(jobs, /recoverable: boolean/, 'the bin says whether a row can come back')
assert.match(jobs, /detailsFromAudit: boolean/, 'and where the details came from')
assert.match(jobs, /async function auditSnapshots/, 'old tombstones are filled in from the activity log')

// 4. The panel reads the restore back ---------------------------------------
assert.match(admin, /const \[previewId, setPreviewId\] = useState<string \| null>\(null\)/, 'a row can be previewed')
assert.match(admin, /👁 Preview/, 'the preview has a button')
assert.match(admin, /\{item\.recoverable \? \(/, 'only a restorable row offers Restore')
assert.match(admin, /'↩ Restore'/, 'the restore button is labelled')
assert.match(admin, /Post it again/, 'an unrestorable row offers the form instead')
assert.match(admin, /const \[list\] = await Promise\.all\(\[\s*reload\(\)/, 'a restore re-reads the catalogue')
assert.match(admin, /refreshDeleted\(\)/, 'and the bin')
assert.doesNotMatch(admin, /onNotice\(`Restored “\$\{target\.title\}”\. It is live in the app again\.`\)\s*\n\s*onMutate\(\)/,
  'a restore no longer stops at a banner')

// 5. The form can be started from what the log remembers ---------------------
assert.match(form, /seed\?: Partial<Job>/, 'the post form accepts a seed')
assert.match(form, /const start = job \?\? seed \?\? null/, 'a saved vacancy wins over a seed')
assert.doesNotMatch(form, /useState\(job\?\.title/, 'the initial values read through it')

// 6. The migration is in the deployment list ---------------------------------
assert.match(copy, /supabase\/vacancy_restore\.sql/, 'the SQL is part of the numbered deployment')

console.log('vacancy restore: the tombstone keeps the row, restore is a checked server call, and the panel lists, previews and restores — passed')
