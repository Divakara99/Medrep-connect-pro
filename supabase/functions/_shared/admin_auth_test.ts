import { hasVerifiedAal2 } from './supabase.ts'
import { adminAccessAllowed, isAdmin, isVacancyEditor } from './http.ts'

const userId = '11111111-1111-4111-8111-111111111111'

function token(claims: Record<string, string>) {
  // These dummy tokens are deliberately unsigned. The helper must be called
  // only AFTER authenticate/getUser has independently verified the real JWT.
  return `header.${btoa(JSON.stringify(claims)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}.signature`
}

Deno.test('admin MFA claim requires aal2 and the authenticated subject', () => {
  if (hasVerifiedAal2(token({ sub: userId, aal: 'aal1' }), userId)) throw new Error('aal1 must be denied')
  if (hasVerifiedAal2(token({ sub: 'other', aal: 'aal2' }), userId)) throw new Error('different user must be denied')
  if (!hasVerifiedAal2(token({ sub: userId, aal: 'aal2' }), userId)) throw new Error('verified aal2 must be accepted')
  if (hasVerifiedAal2('invalid', userId)) throw new Error('malformed JWT must be denied')
})

Deno.test('administrator access follows the sign-in code switch', () => {
  // Code ON: only a verified (aal2) session gets administrator work done.
  if (!adminAccessAllowed(true, true)) throw new Error('aal2 with the code ON must be allowed')
  if (adminAccessAllowed(false, true)) throw new Error('aal1 with the code ON must be denied')
  // Code OFF (set by the owner in the admin console): password-only is accepted.
  if (!adminAccessAllowed(false, false)) throw new Error('aal1 with the code OFF must be allowed')
  if (!adminAccessAllowed(true, false)) throw new Error('aal2 with the code OFF must still be allowed')
  // Fail safe: anything that is not an explicit `false` means the code is required.
  if (adminAccessAllowed(false, true) !== false) throw new Error('an unknown switch state must deny aal1')
})

Deno.test('roles are read from trusted app_metadata only', () => {
  if (!isAdmin({ role: 'admin' })) throw new Error('role=admin is an administrator')
  if (!isAdmin({ is_admin: 'true' })) throw new Error('is_admin=true is an administrator')
  if (isAdmin({ role: 'user' })) throw new Error('a normal user is not an administrator')
  if (isAdmin(null)) throw new Error('no metadata is not an administrator')
  if (!isVacancyEditor({ role: 'vacancy_editor' })) throw new Error('vacancy_editor is the team role')
  if (isVacancyEditor({ role: 'admin' })) throw new Error('an administrator is not a vacancy editor')
  if (isVacancyEditor({ role: 'user' })) throw new Error('a job seeker is not a vacancy editor')
})
