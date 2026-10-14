import { supabase } from './supabase'
import type { Job } from './jobs'
import { vacancyDraftFingerprint } from './vacancyExtraction'

export type VacancyDuplicateStatus = 'exact' | 'possible' | 'none' | 'incomplete'

export type VacancyDuplicateMatch = Pick<Job,
  'id' | 'title' | 'company' | 'location' | 'category' | 'division' | 'hq' |
  'salary' | 'experience' | 'qualification' | 'ageLimit' | 'vacancyCount' | 'postedAt'
> & { matchType: 'exact' | 'possible' }

export type VacancyDuplicateCheck = {
  status: VacancyDuplicateStatus
  matches: VacancyDuplicateMatch[]
}

export type VacancyDuplicateFields = Pick<Job,
  'title' | 'company' | 'manager' | 'contact' | 'managerAltPhone' | 'managerEmail' |
  'location' | 'hq' | 'division' | 'category' | 'salary' | 'experience' |
  'qualification' | 'ageLimit' | 'vacancyCount' | 'description'
>

function asText(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function parseMatch(value: unknown): VacancyDuplicateMatch | null {
  if (!value || typeof value !== 'object') return null
  const row = value as Record<string, unknown>
  if (typeof row.id !== 'string' || typeof row.title !== 'string') return null
  const category = typeof row.category === 'string' ? row.category as Job['category'] : 'MR'
  return {
    id: row.id,
    title: row.title,
    company: asText(row.company) ?? '',
    location: asText(row.location) ?? '',
    category,
    division: asText(row.division),
    hq: asText(row.hq),
    salary: asText(row.salary),
    experience: asText(row.experience),
    qualification: asText(row.qualification),
    ageLimit: asText(row.ageLimit),
    vacancyCount: asText(row.vacancyCount),
    postedAt: typeof row.postedAt === 'number' ? row.postedAt : 0,
    matchType: row.matchType === 'exact' ? 'exact' : 'possible',
  }
}

/** The server returns only a safe public summary and checks active rows for both authorized posting roles. */
export async function checkVacancyDuplicates(
  fields: VacancyDuplicateFields,
  excludeId?: string,
): Promise<VacancyDuplicateCheck> {
  const { data, error } = await supabase.rpc('check_vacancy_duplicates', {
    p_fields: {
      title: fields.title,
      company: fields.company,
      location: fields.location,
      category: fields.category,
      division: fields.division,
      hq: fields.hq,
      salary: fields.salary,
      experience: fields.experience,
      qualification: fields.qualification,
      ageLimit: fields.ageLimit,
      vacancyCount: fields.vacancyCount,
      description: fields.description,
    },
    p_exclude_id: excludeId ?? null,
  })
  if (error) {
    throw new Error('Could not check existing vacancies. Verify that the duplicate-check database update is installed, then retry.')
  }
  if (!data || typeof data !== 'object') throw new Error('The duplicate check returned an invalid result. No vacancy was posted.')
  const result = data as Record<string, unknown>
  const allowed: VacancyDuplicateStatus[] = ['exact', 'possible', 'none', 'incomplete']
  const status = allowed.includes(result.status as VacancyDuplicateStatus)
    ? result.status as VacancyDuplicateStatus
    : 'incomplete'
  const matches = Array.isArray(result.matches)
    ? result.matches.map(parseMatch).filter((match): match is VacancyDuplicateMatch => match !== null)
    : []
  return { status, matches }
}

export function vacancyDuplicateApprovalKey(
  fields: VacancyDuplicateFields,
  result: VacancyDuplicateCheck,
): string {
  const matches = result.matches.map((match) => ({
    id: match.id,
    matchType: match.matchType,
    title: match.title,
    company: match.company,
    location: match.location,
    category: match.category,
    division: match.division,
    hq: match.hq,
    salary: match.salary,
    experience: match.experience,
    qualification: match.qualification,
    ageLimit: match.ageLimit,
    vacancyCount: match.vacancyCount,
    postedAt: match.postedAt,
  })).sort((left, right) => left.id.localeCompare(right.id))
  return JSON.stringify({ draft: vacancyDraftFingerprint(fields), status: result.status, matches })
}
