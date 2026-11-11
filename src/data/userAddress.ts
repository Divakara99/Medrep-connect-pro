/**
 * The address a job seeker typed, and how the administrator reads it.
 *
 * The profile keeps the full address in `address` and the two short fields in
 * `city` / `state` (some accounts filled only the short ones, and older
 * profiles have neither). The admin list shows one line, never a blank column
 * when something is known, and never the same words twice when the address
 * already ends with the city.
 *
 * Imports nothing, so the tests can load it directly.
 */

export type AddressParts = {
  address?: string | null
  city?: string | null
  state?: string | null
}

const clean = (value: string | null | undefined): string => (typeof value === 'string' ? value.trim() : '')

/** "12 MG Road, Hubballi — Karnataka" / "Hubballi, Karnataka" / "". */
export function addressLine(parts: AddressParts): string {
  const street = clean(parts.address)
  const region = [clean(parts.city), clean(parts.state)].filter(Boolean).join(', ')
  if (!street) return region
  if (!region) return street
  // "12 MG Road, Hubballi 580020" + "Hubballi, Karnataka" must not repeat the
  // city; the state alone is still useful.
  const streetLower = street.toLowerCase()
  const missing = [clean(parts.city), clean(parts.state)]
    .filter(Boolean)
    .filter((part) => !streetLower.includes(part.toLowerCase()))
  return missing.length ? `${street} — ${missing.join(', ')}` : street
}

/** The address as the admin searches it, or "" when there is none. */
export function addressSearchText(parts: AddressParts): string {
  return [clean(parts.address), clean(parts.city), clean(parts.state)].filter(Boolean).join(' ')
}

/** Optional field: at most 200 characters, like every other free-text value. */
export const MAX_ADDRESS_LENGTH = 200

export function addressProblem(value: string): string | null {
  return value.trim().length > MAX_ADDRESS_LENGTH ? `Keep the address under ${MAX_ADDRESS_LENGTH} characters.` : null
}
