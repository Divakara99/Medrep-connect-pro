/** A simple, OCR-friendly image template for manually preparing vacancy posters. */
const FIELDS: Array<[string, number]> = [
  ['JOB TITLE', 280],
  ['COMPANY', 420],
  ['CATEGORY (MR / ABM / OTHER)', 560],
  ['CITY / LOCATION', 700],
  ['HEADQUARTERS (MR / ABM)', 840],
  ['DIVISION', 980],
  ['SALARY', 1120],
  ['EXPERIENCE', 1260],
  ['QUALIFICATION / AGE LIMIT', 1400],
  ['NUMBER OF OPENINGS', 1540],
  ['MANAGER NAME', 1680],
  ['CONTACT NUMBER', 1820],
  ['ALTERNATE NUMBER / EMAIL', 1960],
  ['JOB DESCRIPTION', 2100],
]

const TEMPLATE = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="2400" viewBox="0 0 1200 2400">
<rect width="1200" height="2400" fill="#ffffff"/><rect x="36" y="36" width="1128" height="2328" rx="28" fill="none" stroke="#1e3a8a" stroke-width="8"/>
<text x="600" y="125" text-anchor="middle" font-family="Arial,sans-serif" font-size="48" font-weight="700" fill="#1e3a8a">VACANCY DETAILS</text>
<text x="600" y="178" text-anchor="middle" font-family="Arial,sans-serif" font-size="25" fill="#475569">MedRep Connect · Complete the fields and upload this image</text>
${FIELDS.map(([label, y]) => `<text x="90" y="${y - 35}" font-family="Arial,sans-serif" font-size="29" font-weight="700" fill="#0f172a">${label}</text><line x1="90" y1="${y}" x2="1110" y2="${y}" stroke="#94a3b8" stroke-width="3"/>`).join('')}
<line x1="90" y1="2220" x2="1110" y2="2220" stroke="#cbd5e1" stroke-width="2"/><line x1="90" y1="2280" x2="1110" y2="2280" stroke="#cbd5e1" stroke-width="2"/>
</svg>`

export function vacancyTemplateDataUrl(): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(TEMPLATE)}`
}
