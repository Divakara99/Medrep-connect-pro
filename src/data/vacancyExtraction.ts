import type { JobCategory } from './jobs'

export type VacancyExtraction = Partial<{
  title: string
  company: string
  manager: string
  contact: string
  managerAltPhone: string
  managerEmail: string
  location: string
  hq: string
  division: string
  category: Exclude<JobCategory, 'All'>
  salary: string
  experience: string
  description: string
  qualification: string
  ageLimit: string
  vacancyCount: string
}>

type ExtractedLine = { value: string; indexes: number[] }

const LABEL_HEADINGS = /^(?:company(?:\s+name)?|employer|division|vacancy\s+area|area|location|territory|work\s+location|headquarters|head\s+office|hq|experience|work\s+experience|salary|annual\s+package|package|ctc|pay|qualification|qualifications|education|age(?:\s+limit)?|no\.?\s*of\s+vacancies|number\s+of\s+vacancies|vacancies|openings|positions|job\s+title|title|designation|role|position|manager(?:\s+name)?|hiring\s+manager|reporting\s+manager|contact(?:\s+(?:person|name|details|info|information|for\s+(?:more\s+)?details))?|hr\s+(?:contact|manager)|recruiter|description|job\s+description|job\s+profile|role\s+description|job\s+summary|summary|responsibilities|key\s+responsibilities|job\s+responsibilities|roles?\s+and\s+responsibilities|duties|alternate(?:\s+(?:phone|mobile|mob|number))?|alternative(?:\s+(?:phone|mobile|mob|number))?|secondary(?:\s+(?:phone|mobile|mob|number))?|additional(?:\s+(?:phone|mobile|mob|number))?|mobile|mob|phone|tel|email|e-?mail|interested\s+candidates)\s*[:：|·•–—-]?\s*$/i

const MANAGER_LABEL = /^\s*(?:(?:(?:hiring|reporting|area|regional|zonal)\s+)?manager(?:\s+name)?|contact(?:\s+(?:person|name|details|info|information|for\s+(?:more\s+)?details))?|hr\s+(?:contact|manager)|recruiter|for\s+(?:(?:more|further)\s+)?(?:details|information)(?:\s+(?:please\s+)?contact)?|reach\s+out\s+to|apply\s+to)\s*(?:[:：|·•–—-]\s*)?(.*)$/i
const ALTERNATE_PHONE_LABEL = /^\s*(?:alternate|alternative|secondary|additional|manager\s+(?:alternate|secondary)|alt\.?)\s*(?:(?:phone|mobile|mob|number|no\.?|contact)\s*(?:number|no\.?)?)?\s*(?:[:：|·•–—-]\s*)?(.*)$/i
const DESCRIPTION_HEADING = /^\s*(?:job\s+description|description|role\s+description|job\s+profile|job\s+summary|summary|job\s+responsibilities|key\s+responsibilities|roles?\s+and\s+responsibilities|responsibilities|duties|role\s+overview)\s*(?:[:：|·•–—-]\s*)?(.*)$/i
const CONTACT_BLOCK_HEADING = /^\s*(?:interested\s+candidates|contact(?:\s+(?:person|name|details|info|information|for\s+(?:more\s+)?details))?|for\s+(?:(?:more|further)\s+)?(?:details|information)|reach\s+out)\b/i
const CONTACT_CHANNEL = /^\s*(?:mobile|mob|phone|tel|telephone|email|e-?mail|whatsapp|call)\b/i
const PRIVATE_CONTACT_DETAIL = /^\s*(?:mobile|mob|phone|tel|telephone|email|e-?mail|whatsapp)\b/i
const SALES_ROLES = '(?:AFM|RBM|ABM|ASM|RSM|DSM|ZBM|ZSM|NSM|GM|HRM|TM|RM)'

function cleanLines(text: string): string[] {
  return text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line
      .replace(/\u00a0/g, ' ')
      .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, ' ')
      .replace(/^\s*[•*▪▸►]+\s*/, '')
      .trim())
    .filter(Boolean)
}

function cleanValue(value: string): string {
  return value
    .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, ' ')
    .replace(/^\s*[:：|·•–—-]+\s*/, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function readValues(lines: string[], label: RegExp): ExtractedLine[] {
  const values: ExtractedLine[] = []
  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(label)
    if (!match) continue
    let value = cleanValue(match[1] ?? '')
    const indexes = [index]
    if (!value) {
      let next = index + 1
      while (next < lines.length && !lines[next].trim()) next += 1
      if (next < lines.length && !LABEL_HEADINGS.test(lines[next])) {
        value = cleanValue(lines[next])
        indexes.push(next)
      }
    }
    if (value) values.push({ value, indexes })
  }
  return values
}

function readFirst(lines: string[], label: RegExp, consumed: Set<number>): string | undefined {
  const found = readValues(lines, label)[0]
  if (!found) return undefined
  found.indexes.forEach((index) => consumed.add(index))
  return found.value
}

function allLabelIndexes(lines: string[], label: RegExp, consumed: Set<number>): string[] {
  const values = readValues(lines, label)
  for (const found of values) found.indexes.forEach((index) => consumed.add(index))
  return values.map((found) => found.value)
}

function findCategory(text: string): Exclude<JobCategory, 'All'> | undefined {
  const checks: [Exclude<JobCategory, 'All'>, RegExp][] = [
    ['MR', /\b(?:medical\s+representative|MR)\b/i],
    ['ABM', /\b(?:area\s+business\s+manager|ABM)\b/i],
    ['Part-time', /\bpart[ -]?time\b/i],
    ['E-commerce', /\b(?:e[ -]?commerce|ecom)\b/i],
    ['Finance', /\bfinance\b/i],
    ['Banking', /\bbanking\b/i],
    ['IT', /\bIT\b|information\s+technology/i],
    ['Healthcare', /\bhealth\s?care\b/i],
    ['Insurance', /\binsurance\b/i],
    ['FMCG', /\bFMCG\b/i],
    ['Field', /\bfield\s+(?:sales|force|role)\b/i],
  ]
  return checks.find(([, pattern]) => pattern.test(text))?.[0]
}

function categoryTitle(category?: Exclude<JobCategory, 'All'>): string | undefined {
  if (category === 'MR') return 'Medical Representative (MR)'
  if (category === 'ABM') return 'Area Business Manager (ABM)'
  return undefined
}

function firstPhoneNumbers(text: string): string[] {
  const matches = text.match(/\+?\s*\d[\d\s().-]{7,}\d/g) ?? []
  const numbers: string[] = []
  for (const match of matches) {
    const digits = match.replace(/\D/g, '')
    const local = digits.length === 14 && digits.startsWith('0091')
      ? digits.slice(4)
      : digits.length === 12 && digits.startsWith('91')
        ? digits.slice(2)
        : digits.length === 11 && digits.startsWith('0')
          ? digits.slice(1)
          : digits
    if (/^[6-9]\d{9}$/.test(local) && !numbers.includes(local)) numbers.push(local)
  }
  return numbers
}

function cleanPersonName(raw: string): string | undefined {
  let value = cleanValue(raw)
  if (!value) return undefined

  const rolePrefix = value.match(new RegExp(`^${SALES_ROLES}\\s*[:：|–—-]\\s*(.+)$`, 'i'))
  if (rolePrefix) value = rolePrefix[1].trim()
  value = value
    .replace(new RegExp(`\\s*\\(\\s*${SALES_ROLES}\\s*\\)\\s*$`, 'i'), '')
    .replace(new RegExp(`\\s*[–—-]\\s*${SALES_ROLES}\\s*$`, 'i'), '')
    .replace(/\s*[|,;]\s*(?:mob(?:ile)?|phone|tel|email|e-?mail|whatsapp|call)\b.*$/i, '')
    .replace(/^(?:mr|mrs|ms|miss|dr)\.?\s+/i, '')
    .replace(/\s+/g, ' ')
    .trim()

  if (!value || /[@\d]/.test(value) || !/^\p{L}[\p{L}\p{M} .'-]{0,78}$/u.test(value)) return undefined
  if (/^(?:contact|contact details|manager|mobile|mob|phone|email|interested candidates|call|whatsapp)$/i.test(value)) return undefined
  return value
}

function inferManagerFromContactBlock(lines: string[], start: number, consumed: Set<number>): string | undefined {
  if (start < 0) return undefined
  const roleMarker = new RegExp(`(?:^${SALES_ROLES}\\s*[:：|–—-]|\\(\\s*${SALES_ROLES}\\s*\\))`, 'i')

  for (let index = start + 1; index < lines.length; index += 1) {
    if ((consumed.has(index) || LABEL_HEADINGS.test(lines[index])) && !CONTACT_CHANNEL.test(lines[index])) break
    if (CONTACT_CHANNEL.test(lines[index])) continue

    const hasAdjacentContactChannel = CONTACT_CHANNEL.test(lines[index - 1] ?? '')
      || CONTACT_CHANNEL.test(lines[index + 1] ?? '')
      || /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(lines[index - 1] ?? '')
      || /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(lines[index + 1] ?? '')
    if (!hasAdjacentContactChannel && !roleMarker.test(lines[index])) continue

    const name = cleanPersonName(lines[index])
    if (name) return name
  }
  return undefined
}

function inferManagerFromRoleTaggedLines(lines: string[]): string | undefined {
  const roleMarker = new RegExp(`(?:^${SALES_ROLES}\\s*[:：|–—-]|\\(\\s*${SALES_ROLES}\\s*\\))`, 'i')

  for (let index = 0; index < lines.length; index += 1) {
    if (!roleMarker.test(lines[index])) continue
    const hasAdjacentContactChannel = CONTACT_CHANNEL.test(lines[index - 1] ?? '')
      || CONTACT_CHANNEL.test(lines[index + 1] ?? '')
      || firstPhoneNumbers(lines[index - 1] ?? '').length > 0
      || firstPhoneNumbers(lines[index + 1] ?? '').length > 0
      || firstPhoneNumbers(lines[index]).length > 0
    if (!hasAdjacentContactChannel) continue

    const name = cleanPersonName(lines[index])
    if (name) return name
  }
  return undefined
}

function extractExplicitDescription(lines: string[], consumed: Set<number>, contactBlockStart: number): string | undefined {
  const start = lines.findIndex((line) => DESCRIPTION_HEADING.test(line))
  if (start < 0) return undefined

  const heading = lines[start].match(DESCRIPTION_HEADING)
  const points: string[] = []
  const firstPoint = cleanValue(heading?.[1] ?? '')
  const firstPointHasPrivateDetails = PRIVATE_CONTACT_DETAIL.test(firstPoint)
    || /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(firstPoint)
    || firstPhoneNumbers(firstPoint).length > 0
    || /call\s+or\s+whats?app|send\s+(?:your\s+)?resume/i.test(firstPoint)
  if (firstPoint && !firstPointHasPrivateDetails) points.push(firstPoint)

  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index]
    if (index === contactBlockStart || consumed.has(index) || LABEL_HEADINGS.test(line) || CONTACT_BLOCK_HEADING.test(line)) break
    if (PRIVATE_CONTACT_DETAIL.test(line) || /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(line) || firstPhoneNumbers(line).length > 0) break
    if (/call\s+or\s+whats?app|send\s+(?:your\s+)?resume/i.test(line)) break
    points.push(line)
  }

  const description = points.join('\n').trim()
  return description ? description.slice(0, 4000) : undefined
}

function categorySourceText(lines: string[]): string {
  const contactStart = lines.findIndex((line) => CONTACT_BLOCK_HEADING.test(line))
  const roleTag = new RegExp(`(?:^${SALES_ROLES}\\s*[:：|–—-]|\\(\\s*${SALES_ROLES}\\s*\\))`, 'i')
  return lines.filter((line, index) => {
    if (contactStart >= 0 && index >= contactStart) return false
    if (!roleTag.test(line)) return true
    const nearContact = CONTACT_CHANNEL.test(lines[index - 1] ?? '')
      || CONTACT_CHANNEL.test(lines[index + 1] ?? '')
      || firstPhoneNumbers(lines[index - 1] ?? '').length > 0
      || firstPhoneNumbers(lines[index + 1] ?? '').length > 0
    return !nearContact
  }).join(String.fromCharCode(10))
}

function valueAfterUrgency(line: string): string {
  return cleanValue(line.replace(/^\s*(?:(?:urgently|urgent|immediately)\s+)?(?:required|wanted|vacancy\s+for)\s*/i, ''))
}

/**
 * Read common vacancy-poster labels into a draft. This is intentionally a
 * suggestion-only parser: unknown lines do not become public description text.
 * A description is auto-filled only when the source explicitly labels one, and
 * the user reviews every pre-filled value before posting.
 */
export function extractVacancyFields(source: string): VacancyExtraction {
  const lines = cleanLines(source)
  const wholeText = lines.join('\n')
  const consumed = new Set<number>()
  const result: VacancyExtraction = {}

  const category = findCategory(categorySourceText(lines))
  if (category) result.category = category

  const titleValue = readFirst(lines, /^\s*(?:job\s+title|title|designation|role|position)\s*(?:[:：|·•–—-]\s*)?(.*)$/i, consumed)
  if (titleValue) {
    const compactTitle = titleValue.replace(/[.!]+$/, '').trim()
    result.title = /^(?:MR|medical\s+representative)$/i.test(compactTitle) && category
      ? categoryTitle(category) ?? compactTitle
      : compactTitle
  } else {
    const roleIndex = lines.findIndex((line) => /\bmedical\s+representative(?:\s*\(\s*MR\s*\))?\b/i.test(line))
    if (roleIndex >= 0) {
      const role = lines[roleIndex].match(/medical\s+representative(?:\s*\(\s*MR\s*\))?/i)?.[0]
      if (role) result.title = categoryTitle('MR') ?? role.replace(/\s+/g, ' ').trim()
      consumed.add(roleIndex)
    } else if (category) {
      const headlineIndex = lines.findIndex((line) => /\b(?:urgently|required|vacancy\s+for|wanted)\b/i.test(line) && /\b(?:MR|ABM)\b/i.test(line))
      if (headlineIndex >= 0) consumed.add(headlineIndex)
      result.title = categoryTitle(category) ?? lines[headlineIndex] ?? category
    } else {
      const headlineIndex = lines.findIndex((line) => /\b(?:vacancy\s+for|designation|job\s+title)\b/i.test(line))
      if (headlineIndex >= 0) {
        const cleaned = valueAfterUrgency(lines[headlineIndex])
        if (cleaned) result.title = cleaned
        consumed.add(headlineIndex)
      }
    }
  }

  const company = readFirst(lines, /^\s*(?:company(?:\s+name)?|employer)\s*(?:[:：|·•–—-]\s*)?(.*)$/i, consumed)
  if (company) result.company = company.replace(/[.!]+$/, '').trim()
  else {
    const companyIndex = lines.findIndex((line) => /\b(?:pvt\.?\s*ltd\.?|private\s+limited|limited|pharma|organics|laboratories|biotech|healthcare)\b/i.test(line)
      && !/^(?:division|pharma\s+division)\b/i.test(line))
    if (companyIndex >= 0) {
      result.company = lines[companyIndex].replace(/[.!]+$/, '').trim()
      consumed.add(companyIndex)
    }
  }

  const division = readFirst(lines, /^\s*division\s*(?:[:：|·•–—-]\s*)?(.*)$/i, consumed)
  if (division) result.division = division
  else {
    const divisionIndex = lines.findIndex((line) => /^\s*(.+?)\s+division\s*$/i.test(line))
    if (divisionIndex >= 0) {
      result.division = lines[divisionIndex].match(/^\s*(.+?)\s+division\s*$/i)?.[1]?.trim()
      consumed.add(divisionIndex)
    }
  }

  const location = readFirst(lines, /^\s*(?:vacancy\s+area|area|location|territory|work\s+location|posting\s+area)\s*(?:[:：|·•–—-]\s*)?(.*)$/i, consumed)
  if (location) result.location = location

  const hqLabel = /^\s*(?:headquarters|head\s+office|HQs?)\s*(?:[:：|·•–—-]\s*)?(.*)$/i
  const hqValues = allLabelIndexes(lines, hqLabel, consumed)
  if (hqValues.length > 0) {
    result.hq = hqValues.flatMap((value) => value.split(/[;|]/).map((part) => part.trim()).filter(Boolean)).join('\n')
  } else {
    const hqIndex = lines.findIndex((line) => /^\s*(.+?)\s+(?:headquarters|head\s+office)\s*$/i.test(line))
    if (hqIndex >= 0) {
      result.hq = lines[hqIndex].match(/^\s*(.+?)\s+(?:headquarters|head\s+office)\s*$/i)?.[1]?.trim()
      consumed.add(hqIndex)
    }
  }

  const experience = readFirst(lines, /^\s*(?:minimum\s+)?(?:experience|work\s+experience)\s*(?:[:：|·•–—-]\s*)?(.*)$/i, consumed)
  if (experience) result.experience = experience
  else {
    const experienceIndex = lines.findIndex((line) => /^\s*minimum\s+\d+(?:\.\d+)?\s*(?:months?|years?)\s*(?:experience)?\s*$/i.test(line))
    if (experienceIndex >= 0) {
      result.experience = lines[experienceIndex].trim()
      consumed.add(experienceIndex)
    }
  }

  const salary = readFirst(lines, /^\s*(?:annual\s+package|salary|package|CTC|pay|remuneration)\s*(?:[:：|·•–—-]\s*)?(.*)$/i, consumed)
  if (salary) result.salary = salary
  else {
    const salaryIndex = lines.findIndex((line) => /(?:₹|\b(?:INR|Rs\.?))\s*[\d,.]+\s*(?:lpa|lakhs?|per\s+annum)?/i.test(line))
    if (salaryIndex >= 0) {
      result.salary = lines[salaryIndex].trim()
      consumed.add(salaryIndex)
    }
  }

  const age = readFirst(lines, /^\s*(?:age(?:\s+limit)?|maximum\s+age)\s*(?:[:：|·•–—-]\s*)?(.*)$/i, consumed)
  if (age) result.ageLimit = age
  else {
    const ageIndex = lines.findIndex((line) => /\b(?:below|under|maximum|max\.?|up\s+to)\s*\d{2}\s*(?:years?|yrs?)\b/i.test(line))
    if (ageIndex >= 0) {
      result.ageLimit = lines[ageIndex].trim()
      consumed.add(ageIndex)
    }
  }

  const qualification = readFirst(lines, /^\s*(?:qualification|qualifications|educational\s+qualification|education)\s*(?:[:：|·•–—-]\s*)?(.*)$/i, consumed)
  if (qualification) result.qualification = qualification
  else {
    const qualificationIndex = lines.findIndex((line) => /\b(?:any\s+degree|B\.?\s*Pharm|M\.?\s*Pharm|B\.?\s*Sc|graduate|post[ -]?graduate)\b/i.test(line))
    if (qualificationIndex >= 0) {
      result.qualification = lines[qualificationIndex].trim()
      consumed.add(qualificationIndex)
    }
  }

  const vacancyCount = readFirst(lines, /^\s*(?:no\.?\s*of\s+vacancies|number\s+of\s+vacancies|vacancy\s+count|openings|positions|vacancies)\s*(?:[:：|·•–—-]\s*)?(.*)$/i, consumed)
  if (vacancyCount) result.vacancyCount = vacancyCount
  else {
    const openingsIndex = lines.findIndex((line) => /^\s*\d+\s+(?:openings?|positions?|vacancies)\s*$/i.test(line))
    if (openingsIndex >= 0) {
      result.vacancyCount = lines[openingsIndex].trim()
      consumed.add(openingsIndex)
    }
  }

  for (const found of readValues(lines, MANAGER_LABEL)) {
    const name = cleanPersonName(found.value)
    if (!name) continue
    result.manager = name
    found.indexes.forEach((index) => consumed.add(index))
    break
  }

  const email = wholeText.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0]
  if (email) result.managerEmail = email.trim()
  const phones = firstPhoneNumbers(wholeText)
  const explicitAlternate = readValues(lines, ALTERNATE_PHONE_LABEL)
    .flatMap((found) => firstPhoneNumbers(found.value))[0]
  if (explicitAlternate) {
    result.managerAltPhone = explicitAlternate
    const primary = phones.find((phone) => phone !== explicitAlternate)
    if (primary) result.contact = primary
  } else {
    if (phones[0]) result.contact = phones[0]
    if (phones[1]) result.managerAltPhone = phones[1]
  }

  const contactBlockStart = lines.findIndex((line) => CONTACT_BLOCK_HEADING.test(line))
  if (contactBlockStart >= 0) {
    if (!result.manager) result.manager = inferManagerFromContactBlock(lines, contactBlockStart, consumed)
    const nextSection = /^(?:company(?:\s+name)?|employer|division|vacancy\s+area|area|location|territory|headquarters|head\s+office|hq|experience|work\s+experience|salary|annual\s+package|package|ctc|qualification|qualifications|education|age(?:\s+limit)?|no\.?\s*of\s+vacancies|number\s+of\s+vacancies|vacancies|openings|positions|job\s+title|title|designation|role|manager(?:\s+name)?|description|job\s+description|job\s+profile|responsibilities|key\s+responsibilities)\b/i
    for (let index = contactBlockStart; index < lines.length; index += 1) {
      if (index > contactBlockStart && nextSection.test(lines[index])) break
      consumed.add(index)
    }
  }

  if (!result.manager) result.manager = inferManagerFromRoleTaggedLines(lines)

  const description = extractExplicitDescription(lines, consumed, contactBlockStart)
  if (description) result.description = description

  return result
}

/** Stable normalized snapshot used to make a duplicate approval apply only to the reviewed draft. */
export function vacancyDraftFingerprint(fields: Record<string, unknown>): string {
  const keys = [
    'title', 'company', 'manager', 'contact', 'managerAltPhone', 'managerEmail', 'location',
    'hq', 'division', 'category', 'salary', 'experience', 'description', 'qualification',
    'ageLimit', 'vacancyCount',
  ]
  return JSON.stringify(keys.map((key) => {
    const value = typeof fields[key] === 'string' ? fields[key] as string : ''
    return value.toLowerCase().replace(/\s+/g, ' ').trim()
  }))
}
