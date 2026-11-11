/**
 * Salary strings are typed by hand ("₹ 10,000 - ₹ 15,000 / month"), so the card
 * splits the period off to set it in the smaller italic style — and leaves the
 * whole string alone when it cannot tell.
 *
 * Imports nothing, so the tests can load it directly.
 */
export type SalaryParts = { amount: string; unit: string }

export function salaryParts(salary?: string | null): SalaryParts {
  const text = (salary ?? '').trim()
  if (!text) return { amount: '', unit: '' }

  // "… / month", "…/month"
  const slash = text.match(/^(.*?)\s*\/\s*([A-Za-z]+)\s*$/)
  if (slash && slash[1]) return { amount: slash[1].trim(), unit: `/ ${slash[2].toLowerCase()}` }

  // "… per month", "… a month"
  const per = text.match(/^(.*?)\s+(?:per|a)\s+([A-Za-z]+)\s*$/i)
  if (per && per[1]) return { amount: per[1].trim(), unit: `/ ${per[2].toLowerCase()}` }

  return { amount: text, unit: '' }
}
