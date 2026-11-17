import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const ui = read('src/components/ui.tsx')
const userApp = read('src/App.tsx')
const admin = read('src/screens/AdminScreen.tsx')
const vacancyTeam = read('src/screens/VacancyPortal.tsx')

assert.match(ui, /export function RefreshIconButton/)
assert.match(ui, /aria-label=\{label\}/)
for (const [role, source] of [['job seeker', userApp], ['administrator', admin], ['vacancy team', vacancyTeam]]) {
  assert.match(source, /RefreshIconButton onClick=\{\(\) => window\.location\.reload\(\)\}/, `${role} toolbar is missing its refresh button`)
}
console.log('role refresh: reload control is present in all three authenticated role headers')
