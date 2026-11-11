/**
 * Extra vacancy details — the fields the fixed form does not have.
 *
 * A vacancy can carry "Territory: Hubballi North" or "Joining: Immediate"
 * without a schema change: the row is jsonb, so these live in `data.extraFields`
 * as label/value pairs. They are PUBLIC, next to salary and experience, which is
 * why both a phone number and an email address are refused here — the same rule
 * the description guard applies.
 *
 * This module deliberately imports nothing: the extraction tests load it
 * directly with Node's type stripping.
 */

export type ExtraField = { label: string; value: string }

export const EXTRA_FIELD_LIMIT = 12
export const EXTRA_LABEL_MAX = 40
export const EXTRA_VALUE_MAX = 200

/** Rejects a phone number or an email address anywhere in a public value. */
export function extraFieldProblem(label: string, value: string): string | null {
  const trimmedLabel = label.trim()
  const trimmedValue = value.trim()
  if (!trimmedLabel) return 'Give the field a name, such as “Territory” or “Joining date”.'
  if (trimmedLabel.length > EXTRA_LABEL_MAX) return `Keep the field name under ${EXTRA_LABEL_MAX} characters.`
  if (!trimmedValue) return 'Give the field a value, or remove the field.'
  if (trimmedValue.length > EXTRA_VALUE_MAX) return `Keep the value under ${EXTRA_VALUE_MAX} characters.`
  if (/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/.test(trimmedValue)) {
    return 'Remove the email address — every vacancy detail is public.'
  }
  if (/\+?\d[\d\s().-]{7,}\d/.test(trimmedValue)) {
    return 'Remove the phone number — every vacancy detail is public.'
  }
  return null
}

/** Keeps only well-formed fields, without duplicates, in the order given. */
export function cleanExtraFields(fields: ExtraField[] | undefined): ExtraField[] {
  const seen = new Set<string>()
  const clean: ExtraField[] = []
  for (const field of fields ?? []) {
    if (clean.length >= EXTRA_FIELD_LIMIT) break
    if (extraFieldProblem(field.label, field.value)) continue
    const key = field.label.trim().toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    clean.push({ label: field.label.trim(), value: field.value.trim() })
  }
  return clean
}
