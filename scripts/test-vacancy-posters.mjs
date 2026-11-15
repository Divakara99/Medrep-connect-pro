import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const [poster, migration, form, detail, jobs, auth] = await Promise.all([
  readFile(new URL('../src/data/vacancyPoster.ts', import.meta.url), 'utf8'),
  readFile(new URL('../supabase/vacancy_posters.sql', import.meta.url), 'utf8'),
  readFile(new URL('../src/components/VacancyForm.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/components/JobDetail.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/data/jobs.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/data/supabase.ts', import.meta.url), 'utf8'),
])

assert.match(poster, /MAX_VACANCY_POSTER_BYTES = 8 \* 1024 \* 1024/)
assert.match(poster, /new Set\(\['image\/jpeg', 'image\/png', 'image\/webp'\]\)/)
assert.match(poster, /createSignedUrl\(path, 900\)/)
assert.match(form, /uploadVacancyPoster\(sourceImage\)/)
assert.match(form, /posterPath, extraFields/)
assert.match(detail, /fullDetails && <VacancyPoster path=\{job\.posterPath\}/)
assert.match(detail, /vacancyPosterSignedUrl\(path\)/)
assert.match(jobs, /posterPath: typeof row\.posterPath === 'string' \? row\.posterPath/)
assert.match(migration, /public = false/)
assert.match(migration, /vacancy_posters_admin_insert/)
assert.match(migration, /app_metadata.*role.*admin/s)
assert.match(migration, /vacancy_posters_entitled_read/)
assert.match(migration, /ju\.payment_status = 'paid'/)
assert.match(migration, /'posterPath', v\.data ->> 'posterPath'/)
assert.match(migration, /public\.employee_post_vacancy\(p_fields jsonb\)/)
assert.match(migration, /v_data := jsonb_build_object\([\s\S]*?'posterPath', nullif\(v_poster_path, ''\)/)
assert.match(migration, /public\.is_vacancy_editor\(\)/)
assert.match(migration, /Choose a poster uploaded from this account/)
assert.match(await readFile(new URL('../src/data/vacancyTeam.ts', import.meta.url), 'utf8'), /posterPath: fields\.posterPath \?\? ''/)
assert.match(auth, /@capacitor\/preferences/)
assert.match(auth, /storage: supabaseAuthStorage/)
assert.match(auth, /Preferences\.set\(\{ key, value \}\)/)
assert.match(auth, /localStorage\.removeItem\(key\)/)

console.log('vacancy posters: private upload, entitled signed display, secure job projection, and persistent native auth storage — passed')
