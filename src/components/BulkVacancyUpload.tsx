import { useRef, useState } from 'react'
import { addJob, CATEGORIES, type Job } from '../data/jobs'
import { findConfidentialContact } from '../data/jobDescription'
import { digitsOnly, mobileNumberProblem, normalizeIndianMobile, requiredHeadquartersProblem } from '../data/vacancyRules'
import { parseCsv, type VacancyCsvRow } from '../data/vacancyCsv'
import { checkVacancyDuplicates, type VacancyDuplicateFields } from '../data/vacancyDuplicates'
import { Button, Card } from './ui'

type JobDraft = Omit<Job, 'id' | 'postedAt'>
type PreparedRow = { rowNumber: number; title: string; draft?: JobDraft; errors: string[] }

const MAX_FILE_BYTES = 2 * 1024 * 1024
const MAX_ROWS = 100
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function duplicateFields(draft: JobDraft): VacancyDuplicateFields {
  return {
    title: draft.title,
    company: draft.company,
    manager: draft.manager,
    contact: draft.contact,
    managerAltPhone: draft.managerAltPhone,
    managerEmail: draft.managerEmail,
    location: draft.location,
    hq: draft.hq,
    division: draft.division,
    category: draft.category,
    salary: draft.salary,
    experience: draft.experience,
    qualification: draft.qualification,
    ageLimit: draft.ageLimit,
    vacancyCount: draft.vacancyCount,
    description: draft.description,
  }
}

function prepareRow(row: VacancyCsvRow, index: number): PreparedRow {
  const errors: string[] = []
  const title = row.title.trim()
  const company = row.company.trim()
  const location = row.city.trim()
  const category = row.category.trim()
  if (!title) errors.push('Title is required.')
  if (!company) errors.push('Company is required.')
  if (!location) errors.push('City is required.')
  if (!CATEGORIES.some((option) => option !== 'All' && option === category)) errors.push('Choose a valid category.')
  const contactProblem = mobileNumberProblem(row.contact)
  if (contactProblem) errors.push(`Contact number: ${contactProblem}`)
  const alternateProblem = mobileNumberProblem(row.alternateContact, { optional: true })
  if (alternateProblem) errors.push(`Alternate contact: ${alternateProblem}`)
  if (row.managerEmail && !emailPattern.test(row.managerEmail.trim())) errors.push('Manager email is not valid.')
  const hqEntries = row.hq.split(/[;\r\n]+/).map((entry) => entry.trim()).filter(Boolean)
  const hqProblem = requiredHeadquartersProblem(category, hqEntries)
  if (hqProblem) errors.push(`HQ: ${hqProblem}`)
  const descriptionProblem = findConfidentialContact(row.description)
  if (descriptionProblem) errors.push(descriptionProblem)

  const validCategory = CATEGORIES.find((option) => option !== 'All' && option === category) as Exclude<Job['category'], 'All'> | undefined
  if (errors.length || !validCategory) return { rowNumber: index + 2, title: title || `CSV row ${index + 2}`, errors }

  return {
    rowNumber: index + 2,
    title,
    errors,
    draft: {
      title,
      company,
      category: validCategory,
      manager: row.manager.trim() || undefined,
      contact: digitsOnly(row.contact),
      managerAltPhone: row.alternateContact.trim() ? normalizeIndianMobile(row.alternateContact) : undefined,
      managerEmail: row.managerEmail.trim() || undefined,
      location,
      hq: hqEntries.length ? hqEntries.join('\n') : undefined,
      division: row.division.trim() || undefined,
      salary: row.salary.trim() || undefined,
      experience: row.experience.trim() || undefined,
      qualification: row.qualification.trim() || undefined,
      ageLimit: row.ageLimit.trim() || undefined,
      vacancyCount: row.vacancyCount.trim() || undefined,
      description: row.description.trim() || undefined,
      pinned: false,
      extraFields: [],
    },
  }
}

/** CSV template parser and one-click batch posting for admins. */
export function BulkVacancyUpload({ onComplete }: { onComplete: (count: number) => Promise<void> }) {
  const [rows, setRows] = useState<PreparedRow[]>([])
  const inputRef = useRef<HTMLInputElement>(null)
  const [fileName, setFileName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [uploaded, setUploaded] = useState(0)
  const [duplicateWarnings, setDuplicateWarnings] = useState<string[]>([])
  const [duplicatesApproved, setDuplicatesApproved] = useState(false)
  const invalidCount = rows.filter((row) => row.errors.length > 0).length

  async function readFile(file?: File) {
    setRows([])
    setFileName(file?.name ?? '')
    setError(null)
    setUploaded(0)
    setDuplicateWarnings([])
    setDuplicatesApproved(false)
    if (!file) return
    if (file.size > MAX_FILE_BYTES) {
      setError('Keep the CSV file under 2 MB.')
      return
    }
    try {
      const parsed = parseCsv(await file.text())
      if (parsed.length > MAX_ROWS) throw new Error(`Upload no more than ${MAX_ROWS} vacancies at a time.`)
      setRows(parsed.map(prepareRow))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not read the CSV file.')
    }
  }

  async function upload() {
    if (busy || rows.length === 0 || invalidCount > 0) return
    setBusy(true)
    setError(null)
    const startingUploaded = uploaded
    let completed = uploaded
    try {
      if (!duplicatesApproved) {
        const warnings: string[] = []
        for (let index = uploaded; index < rows.length; index += 1) {
          const row = rows[index]
          if (!row.draft) continue
          const result = await checkVacancyDuplicates(duplicateFields(row.draft))
          if (result.status !== 'none') {
            const matches = result.matches.map((match) => `“${match.title}” · ${match.company} · ${match.location}`).join('; ')
            warnings.push(`CSV row ${row.rowNumber}: ${matches || 'the server could not fully compare this vacancy'}`)
          }
        }
        if (warnings.length > 0) {
          setDuplicateWarnings(warnings)
          return
        }
      }
      for (let index = uploaded; index < rows.length; index += 1) {
        const draft = rows[index].draft
        if (!draft) throw new Error(`CSV row ${rows[index].rowNumber} is not ready to upload.`)
        try {
          await addJob(draft)
          completed = index + 1
          setUploaded(completed)
        } catch (cause) {
          const reason = cause instanceof Error ? cause.message : 'The vacancy could not be saved.'
          throw new Error(`Uploaded ${completed} of ${rows.length}. Row ${rows[index].rowNumber} failed: ${reason} You can retry the remaining rows.`)
        }
      }
      await onComplete(completed - startingUploaded)
      setRows([])
      setFileName('')
      setUploaded(0)
      setDuplicateWarnings([])
      setDuplicatesApproved(false)
      if (inputRef.current) inputRef.current.value = ''
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The batch could not be uploaded.')
      if (completed > startingUploaded) await onComplete(completed - startingUploaded)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card className="space-y-2.5 p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-sm font-bold text-slate-900">Upload multiple vacancies</h3>
          <p className="mt-0.5 text-xs text-slate-600">Fill one vacancy per CSV row, then upload the validated batch in one action.</p>
        </div>
        <a
          href={`${import.meta.env.BASE_URL}templates/vacancy-bulk-template.csv`}
          download="medrep-vacancy-bulk-template.csv"
          className="shrink-0 rounded-lg bg-brand-50 px-2.5 py-1.5 text-xs font-bold text-brand-800 ring-1 ring-brand-200 hover:bg-brand-100"
        >
          Download CSV template
        </a>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept=".csv,text/csv"
        aria-label="Choose a vacancy batch CSV"
        onChange={(event) => { void readFile(event.target.files?.[0]) }}
        disabled={busy}
        className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-800 file:mr-3 file:rounded-lg file:border-0 file:bg-brand-50 file:px-2.5 file:py-1.5 file:text-xs file:font-bold file:text-brand-800"
      />
      <p className="text-[11px] leading-snug text-slate-500">
        Keep Contact number, Alternate contact and Manager email in separate columns; enter one number per phone column. Separate multiple HQs with semicolons. HQ is required for MR/ABM under the current posting rules, and optional for other categories. Maximum {MAX_ROWS} vacancies per file.
      </p>
      {fileName && <p className="truncate text-xs font-semibold text-slate-700">Selected: {fileName}</p>}
      {rows.length > 0 && (
        <div className="rounded-lg bg-slate-50 px-2.5 py-2 text-xs text-slate-700 ring-1 ring-slate-200">
          {rows.length - invalidCount} of {rows.length} rows ready
          {uploaded > 0 && ` · ${uploaded} already uploaded`}
          {invalidCount > 0 && (
            <details className="mt-1.5">
              <summary className="cursor-pointer font-bold text-rose-700">Fix {invalidCount} invalid row{invalidCount === 1 ? '' : 's'}</summary>
              <ul className="mt-1 list-inside list-disc space-y-0.5 text-rose-800">
                {rows.filter((row) => row.errors.length > 0).map((row) => (
                  <li key={row.rowNumber}>Row {row.rowNumber} ({row.title}): {row.errors.join(' ')}</li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
      {duplicateWarnings.length > 0 && (
        <div className="space-y-1.5 rounded-lg bg-amber-50 px-2.5 py-2 text-xs text-amber-950 ring-1 ring-amber-200">
          <p className="font-bold">Review possible matches before importing.{uploaded > 0 ? ` ${uploaded} earlier rows were already uploaded.` : ' No vacancies have been uploaded yet.'}</p>
          <ul className="list-inside list-disc space-y-0.5">
            {duplicateWarnings.map((warning) => <li key={warning}>{warning}</li>)}
          </ul>
          <label className="flex items-start gap-2 pt-1 font-semibold">
            <input type="checkbox" className="mt-0.5" checked={duplicatesApproved} onChange={(event) => setDuplicatesApproved(event.target.checked)} />
            I reviewed these matches and want to continue with this CSV batch.
          </label>
        </div>
      )}
      {error && <p role="alert" className="text-xs font-bold text-rose-700">{error}</p>}
      <Button type="button" className="w-full sm:w-auto" onClick={() => { void upload() }} disabled={busy || rows.length === 0 || invalidCount > 0 || (duplicateWarnings.length > 0 && !duplicatesApproved)}>
        {busy ? `Uploading ${uploaded} of ${rows.length}…` : duplicateWarnings.length > 0 && !duplicatesApproved ? 'Review matches above' : uploaded > 0 ? `Retry remaining ${rows.length - uploaded}` : duplicatesApproved ? `Upload ${rows.length} vacancies` : `Check duplicates & upload ${rows.length} vacancies`}
      </Button>
    </Card>
  )
}
