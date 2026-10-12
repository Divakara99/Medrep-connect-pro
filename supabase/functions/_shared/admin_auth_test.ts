import { hasVerifiedAal2 } from './supabase.ts'

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
