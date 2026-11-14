export const VACANCY_CSV_HEADERS = [
  'Title',
  'Company',
  'Category',
  'Manager',
  'Contact number',
  'Alternate contact',
  'Manager email',
  'City',
  'HQ',
  'Division',
  'Salary',
  'Experience',
  'Qualification',
  'Age limit',
  'Number of vacancies',
  'Job description',
] as const

export type VacancyCsvRow = {
  title: string
  company: string
  category: string
  manager: string
  contact: string
  alternateContact: string
  managerEmail: string
  city: string
  hq: string
  division: string
  salary: string
  experience: string
  qualification: string
  ageLimit: string
  vacancyCount: string
  description: string
}

const HEADER_KEYS: Record<string, keyof VacancyCsvRow> = {
  title: 'title',
  'job title': 'title',
  company: 'company',
  category: 'category',
  manager: 'manager',
  'contact number': 'contact',
  contact: 'contact',
  'alternate contact': 'alternateContact',
  'alternate number': 'alternateContact',
  'manager email': 'managerEmail',
  email: 'managerEmail',
  city: 'city',
  location: 'city',
  hq: 'hq',
  division: 'division',
  salary: 'salary',
  experience: 'experience',
  qualification: 'qualification',
  'age limit': 'ageLimit',
  'number of vacancies': 'vacancyCount',
  'vacancy count': 'vacancyCount',
  'job description': 'description',
  description: 'description',
}

/** Parse an RFC 4180-style CSV, including escaped quotes and quoted line breaks. */
export function parseCsv(text: string): VacancyCsvRow[] {
  const input = text.replace(/^\uFEFF/, '')
  const records: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index]
    if (quoted) {
      if (char === '"' && input[index + 1] === '"') {
        cell += '"'
        index += 1
      } else if (char === '"') {
        quoted = false
      } else {
        cell += char
      }
      continue
    }
    if (char === '"' && cell.length === 0) {
      quoted = true
    } else if (char === ',') {
      row.push(cell)
      cell = ''
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && input[index + 1] === '\n') index += 1
      row.push(cell)
      if (row.some((value) => value.trim())) records.push(row)
      row = []
      cell = ''
    } else {
      cell += char
    }
  }
  if (quoted) throw new Error('The CSV has an unclosed quote. Check the row and save the file again.')
  row.push(cell)
  if (row.some((value) => value.trim())) records.push(row)
  if (records.length < 2) throw new Error('The CSV must include a header row and at least one vacancy row.')

  const headers = records[0].map((value) => value.trim().toLowerCase())
  const mappedHeaders = headers.map((header) => HEADER_KEYS[header])
  const required = ['title', 'company', 'category', 'contact', 'city'] as const
  const available = new Set(mappedHeaders.filter((key): key is keyof VacancyCsvRow => Boolean(key)))
  const missing = required.filter((key) => !available.has(key))
  if (missing.length) {
    const labels: Record<(typeof required)[number], string> = {
      title: 'Title', company: 'Company', category: 'Category', contact: 'Contact number', city: 'City',
    }
    throw new Error(`Missing required column${missing.length === 1 ? '' : 's'}: ${missing.map((key) => labels[key]).join(', ')}.`)
  }

  return records.slice(1).map((record) => {
    const row: VacancyCsvRow = {
      title: '', company: '', category: '', manager: '', contact: '', alternateContact: '',
      managerEmail: '', city: '', hq: '', division: '', salary: '', experience: '',
      qualification: '', ageLimit: '', vacancyCount: '', description: '',
    }
    mappedHeaders.forEach((key, index) => {
      if (key) row[key] = (record[index] ?? '').trim()
    })
    return row
  })
}
