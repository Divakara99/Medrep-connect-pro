import { useState } from 'react'
import { Badge, Button, Input, Label, Modal, Select, Textarea } from './ui'
import { addJob, CATEGORIES, descriptionPoints, updateJob, type Job } from '../data/jobs'
import { cleanExtraFields, extraFieldProblem, EXTRA_FIELD_LIMIT, type ExtraField } from '../data/extraFields'
import { findConfidentialContact } from '../data/jobDescription'
import { digitsOnly, hasNonPhoneCharacters, mobileNumberProblem, MOBILE_DIGITS, MOBILE_MAX_DIGITS, MAX_HQ_TEXT_LENGTH, headquartersProblem, normalizeIndianMobile, parseHeadquarters, serializeHeadquarters } from '../data/vacancyRules'
import { teamPostVacancy } from '../data/vacancyTeam'
import { extractExtraFields, extractVacancyFields, type VacancyExtraction } from '../data/vacancyExtraction'
import { readVacancyImageText } from '../data/vacancyOcr'
import { checkVacancyDuplicates, vacancyDuplicateApprovalKey, type VacancyDuplicateCheck, type VacancyDuplicateFields } from '../data/vacancyDuplicates'

/**
 * The vacancy form, shared by the administrator (post, edit, pin) and the
 * vacancy team (post only). The database checks the same rules either way.
 */

/**
 * What the pasted-text reader may find, in form order. Auto-fill never writes
 * these on its own: the admin ticks the values that belong in this vacancy.
 */
const EXTRACTED_FIELDS: { key: keyof VacancyExtraction; label: string }[] = [
  { key: 'title', label: 'Title' },
  { key: 'company', label: 'Company' },
  { key: 'category', label: 'Category' },
  { key: 'manager', label: 'Manager' },
  { key: 'contact', label: 'Contact number' },
  { key: 'managerAltPhone', label: 'Alternate number' },
  { key: 'managerEmail', label: 'Manager email' },
  { key: 'location', label: 'City' },
  { key: 'hq', label: 'HQ' },
  { key: 'division', label: 'Division' },
  { key: 'salary', label: 'Salary' },
  { key: 'experience', label: 'Experience' },
  { key: 'qualification', label: 'Qualification' },
  { key: 'ageLimit', label: 'Age limit' },
  { key: 'vacancyCount', label: 'Number of vacancies' },
  { key: 'description', label: 'Job description' },
]

/**
 * `seed` fills a brand-new form (no id) with values that came from somewhere
 * else — the activity log of a deleted vacancy that has no body left to
 * restore. It never edits an existing vacancy: that is what `job` is for.
 */
export function VacancyForm({ job, seed, open, onClose, onSaved, mode = 'admin' }: {
  job: Job | null
  seed?: Partial<Job>
  open: boolean
  onClose: () => void
  onSaved: () => void
  mode?: 'admin' | 'team'
}) {
  // A saved vacancy wins over a seed; both are read-only starting values.
  const start = job ?? seed ?? null
  const [title, setTitle] = useState(start?.title ?? '')
  const [company, setCompany] = useState(start?.company ?? '')
  const [manager, setManager] = useState(start?.manager ?? '')
  // Mobile fields hold digits only — any formatting already on an older
  // vacancy is dropped here, so what is saved is always a clean number.
  const [contact, setContact] = useState(() => digitsOnly(start?.contact ?? ''))
  const [managerAltPhone, setManagerAltPhone] = useState(() => normalizeIndianMobile(start?.managerAltPhone ?? ''))
  // Shown inside the field itself (red border + red text), never in a list
  // below the form.
  const [contactError, setContactError] = useState<string | null>(null)
  const [altPhoneError, setAltPhoneError] = useState<string | null>(null)
  const [managerEmail, setManagerEmail] = useState(start?.managerEmail ?? '')
  const [location, setLocation] = useState(start?.location ?? '')
  const [hqEntries, setHqEntries] = useState(() => {
    const savedEntries = parseHeadquarters(start?.hq)
    return savedEntries.length > 0 ? savedEntries : ['']
  })
  const [hqError, setHqError] = useState<string | null>(null)
  const [division, setDivision] = useState(start?.division ?? '')
  const [category, setCategory] = useState<Exclude<Job['category'], 'All'>>((start?.category as Exclude<Job['category'], 'All'> | undefined) ?? 'MR')
  const [salary, setSalary] = useState(start?.salary ?? '')
  const [experience, setExperience] = useState(start?.experience ?? '')
  const [qualification, setQualification] = useState(start?.qualification ?? '')
  const [ageLimit, setAgeLimit] = useState(start?.ageLimit ?? '')
  const [vacancyCount, setVacancyCount] = useState(start?.vacancyCount ?? '')
  const [description, setDescription] = useState(start?.description ?? '')
  const [pinned, setPinned] = useState(start?.pinned ?? false)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [sourceMode, setSourceMode] = useState<'image' | 'text'>('image')
  const [sourceText, setSourceText] = useState('')
  const [sourceImage, setSourceImage] = useState<File | null>(null)
  const [ocrText, setOcrText] = useState('')
  const [extracting, setExtracting] = useState(false)
  const [extractProgress, setExtractProgress] = useState(0)
  const [extractStatus, setExtractStatus] = useState('')
  const [extractError, setExtractError] = useState<string | null>(null)
  const [extractNotice, setExtractNotice] = useState<string | null>(null)
  // Values found in the pasted text, waiting for the admin to choose them.
  // Details with no field of their own — created by a paste, or added here.
  const [extraFields, setExtraFields] = useState<ExtraField[]>(() => start?.extraFields ?? [])
  // Every extracted value is editable before it is filled: OCR and pasted
  // vacancy text are rarely perfect, and correcting it here is faster than
  // filling the field and editing it afterwards.
  type ReviewExtra = ExtraField & { checked: boolean }
  const [review, setReview] = useState<{
    fields: VacancyExtraction
    picked: Partial<Record<keyof VacancyExtraction, boolean>>
    extras: ReviewExtra[]
  } | null>(null)
  const [duplicatePrompt, setDuplicatePrompt] = useState<{ result: VacancyDuplicateCheck; approvalKey: string } | null>(null)
  const [approvedDuplicateReview, setApprovedDuplicateReview] = useState<string | null>(null)

  /**
   * Mobile fields accept digits only. A letter is refused as it is typed and
   * the complaint stays inside that one field; formatting characters (space,
   * +, -, brackets) are silently dropped, so a pasted number still works.
   */
  function changeMobile(raw: string, setValue: (value: string) => void, setProblem: (problem: string | null) => void, useIndiaPrefix = false) {
    const digits = useIndiaPrefix ? normalizeIndianMobile(raw) : digitsOnly(raw)
    setValue(digits.slice(0, useIndiaPrefix ? MOBILE_DIGITS : MOBILE_MAX_DIGITS))
    setProblem(hasNonPhoneCharacters(raw) ? 'Letters are not allowed here — digits only.' : null)
  }

  function updateHq(index: number, value: string) {
    setHqEntries((entries) => entries.map((entry, current) => current === index ? value : entry))
    setHqError(null)
  }

  function addHq() {
    setHqEntries((entries) => [...entries, ''])
    setHqError(null)
  }

  function removeHq(index: number) {
    setHqEntries((entries) => entries.filter((_, current) => current !== index))
    setHqError(null)
  }

  function collectDraftFields(): VacancyDuplicateFields {
    return {
      title,
      company,
      manager,
      contact,
      managerAltPhone,
      managerEmail,
      location,
      hq: serializeHeadquarters(hqEntries),
      division,
      category,
      salary,
      experience,
      qualification,
      ageLimit,
      vacancyCount,
      description,
    }
  }

  /** What this field holds right now, used to leave typed values alone. */
  function draftValue(key: keyof VacancyExtraction): string {
    switch (key) {
      case 'title': return title
      case 'company': return company
      case 'category': return category
      case 'manager': return manager
      case 'contact': return contact
      case 'managerAltPhone': return managerAltPhone
      case 'managerEmail': return managerEmail
      case 'location': return location
      case 'hq': return serializeHeadquarters(hqEntries)
      case 'division': return division
      case 'salary': return salary
      case 'experience': return experience
      case 'qualification': return qualification
      case 'ageLimit': return ageLimit
      case 'vacancyCount': return vacancyCount
      case 'description': return description
      default: return ''
    }
  }

  /**
   * Writes the values the admin ticked. HQ is special: a pasted block fills the
   * first HQ box and never adds boxes of its own, so importing text can never
   * create new fields in the form.
   */
  function applyExtractedFields(fields: VacancyExtraction) {
    if (fields.title?.trim()) setTitle(fields.title.trim())
    if (fields.company?.trim()) setCompany(fields.company.trim())
    if (fields.manager?.trim()) setManager(fields.manager.trim())
    if (fields.contact?.trim()) {
      setContact(digitsOnly(fields.contact).slice(0, MOBILE_MAX_DIGITS))
      setContactError(null)
    }
    if (fields.managerAltPhone?.trim()) {
      setManagerAltPhone(normalizeIndianMobile(fields.managerAltPhone).slice(0, MOBILE_DIGITS))
      setAltPhoneError(null)
    }
    if (fields.managerEmail?.trim()) setManagerEmail(fields.managerEmail.trim())
    if (fields.location?.trim()) setLocation(fields.location.trim())
    if (fields.hq?.trim()) {
      const hqText = fields.hq
        .split(/\r?\n/)
        .map((entry) => entry.trim())
        .filter(Boolean)
        .join(', ')
        .slice(0, MAX_HQ_TEXT_LENGTH)
      setHqEntries((current) => {
        const next = current.length > 0 ? [...current] : ['']
        if (!next[0].trim() && hqText) next[0] = hqText
        return next
      })
      setHqError(null)
    }
    if (fields.division?.trim()) setDivision(fields.division.trim())
    if (fields.category) setCategory(fields.category)
    if (fields.salary?.trim()) setSalary(fields.salary.trim())
    if (fields.experience?.trim()) setExperience(fields.experience.trim())
    if (fields.qualification?.trim()) setQualification(fields.qualification.trim())
    if (fields.ageLimit?.trim()) setAgeLimit(fields.ageLimit.trim())
    if (fields.vacancyCount?.trim()) setVacancyCount(fields.vacancyCount.trim())
    if (fields.description?.trim()) setDescription(fields.description.trim())
  }

  /** Fills only the ticked values, then says how many fields changed. */
  function applyReviewedFields() {
    if (!review) return
    const chosen: VacancyExtraction = {}
    let filled = 0
    for (const { key } of EXTRACTED_FIELDS) {
      if (!review.picked[key]) continue
      const value = review.fields[key]
      if (typeof value !== 'string' || !value.trim()) continue
      ;(chosen as Record<string, string>)[key] = value
      filled += 1
    }
    applyExtractedFields(chosen)
    const chosenExtras = review.extras
      .filter((extra) => extra.checked)
      .map(({ label, value }) => ({ label, value }))
    if (chosenExtras.length > 0) {
      setExtraFields((current) => cleanExtraFields([...current, ...chosenExtras]))
      filled += chosenExtras.length
    }
    setReview(null)
    setExtractNotice(filled > 0
      ? `Filled ${filled} detail${filled === 1 ? '' : 's'} from the pasted text. Check each value before Final Submit.`
      : 'Nothing was filled. Tick at least one value first.')
  }

  async function readSource() {
    setExtractError(null)
    setError(null)
    setExtractNotice(null)
    setReview(null)
    setExtracting(true)
    setExtractProgress(0)
    setExtractStatus(sourceMode === 'image' ? 'Starting local OCR…' : 'Reading vacancy text…')
    try {
      let rawText = ''
      if (sourceMode === 'image') {
        if (!sourceImage) throw new Error('Choose a flyer or screenshot image first.')
        rawText = await readVacancyImageText(sourceImage, (status, progress) => {
          setExtractStatus(status)
          setExtractProgress(progress)
        })
        setOcrText(rawText)
      } else {
        rawText = sourceText.trim()
        if (!rawText) throw new Error('Paste the vacancy text first.')
        setOcrText('')
      }
      if (!rawText) throw new Error('No readable text was found. Try a clearer image or paste the job text.')

      const extracted = extractVacancyFields(rawText)
      const found = EXTRACTED_FIELDS.filter(({ key }) => {
        const value = extracted[key]
        return typeof value === 'string' && value.trim().length > 0
      })
      const unknown = extractExtraFields(rawText)
      if (found.length === 0 && unknown.length === 0) {
        setExtractNotice('No fields were confidently detected. Read the text above and type the vacancy details yourself.')
        return
      }
      // Nothing is written into the form here. Fields the admin already typed
      // start unticked, so a paste can never overwrite their work.
      const picked: Partial<Record<keyof VacancyExtraction, boolean>> = {}
      for (const { key } of found) picked[key] = !draftValue(key).trim()
      // Lines the fixed form has no field for ("Joining: Immediate") become
      // extra details of this vacancy, ticked by default and editable below.
      const extras = extractExtraFields(rawText)
        .filter((extra) => !extraFields.some((current) => current.label.toLowerCase() === extra.label.toLowerCase()))
        .map((extra) => ({ ...extra, checked: true }))
      setReview({ fields: extracted, picked, extras })
      setExtractNotice(
        `Found ${found.length} value${found.length === 1 ? '' : 's'}${extras.length > 0 ? ` and ${extras.length} extra detail${extras.length === 1 ? '' : 's'}` : ''}.`
        + ' Nothing is filled yet — tick what belongs in this vacancy, and correct any value that was read wrongly.',
      )
    } catch (cause) {
      setExtractError(cause instanceof Error ? cause.message : 'Could not read the vacancy source.')
    } finally {
      setExtracting(false)
      setExtractProgress(0)
      setExtractStatus('')
    }
  }

  function approvePostChoice() {
    if (!duplicatePrompt) return
    setApprovedDuplicateReview(duplicatePrompt.approvalKey)
    setDuplicatePrompt(null)
    setExtractNotice('Status reviewed. Check the fields and use Final Submit only when ready to publish.')
  }

  function resetDraft() {
    setTitle(job?.title ?? '')
    setCompany(job?.company ?? '')
    setManager(job?.manager ?? '')
    setContact(digitsOnly(job?.contact ?? ''))
    setManagerAltPhone(normalizeIndianMobile(job?.managerAltPhone ?? ''))
    setManagerEmail(job?.managerEmail ?? '')
    setLocation(job?.location ?? '')
    const savedHqEntries = parseHeadquarters(job?.hq)
    setHqEntries(savedHqEntries.length > 0 ? savedHqEntries : [''])
    setDivision(job?.division ?? '')
    setCategory(job?.category ?? 'MR')
    setSalary(job?.salary ?? '')
    setExperience(job?.experience ?? '')
    setQualification(job?.qualification ?? '')
    setAgeLimit(job?.ageLimit ?? '')
    setVacancyCount(job?.vacancyCount ?? '')
    setDescription(job?.description ?? '')
    setExtraFields(start?.extraFields ?? [])
    setPinned(job?.pinned ?? false)
    setError(null)
    setContactError(null)
    setAltPhoneError(null)
    setHqError(null)
    setSourceMode('image')
    setSourceText('')
    setSourceImage(null)
    setOcrText('')
    setExtracting(false)
    setExtractProgress(0)
    setExtractStatus('')
    setExtractError(null)
    setExtractNotice(null)
    setReview(null)
    setDuplicatePrompt(null)
    setApprovedDuplicateReview(null)
  }

  function discardDraft() {
    resetDraft()
    onClose()
  }

  async function save() {
    if (!title || !company || !location) {
      setError('Title, company, and location are required.')
      return
    }
    const hqProblem = headquartersProblem(hqEntries)
    setHqError(hqProblem)
    if (hqProblem) {
      setError(null)
      return
    }
    // Each mobile number is checked on its own and reported inside its own box.
    const contactProblem = mobileNumberProblem(contact)
    const altPhoneProblem = mobileNumberProblem(managerAltPhone, { optional: true })
    setContactError(contactProblem)
    setAltPhoneError(altPhoneProblem)
    if (contactProblem || altPhoneProblem) {
      // The message lives in the number's own box, never in a list below the form.
      setError(null)
      return
    }
    // Same rule the database enforces: the description is public, so it must
    // not carry contact details. Catching it here gives an immediate message.
    const confidential = findConfidentialContact(description)
    if (confidential) {
      setError(confidential)
      return
    }
    setSaving(true)
    setError(null)
    try {
      const fields = collectDraftFields()
      const duplicateResult = await checkVacancyDuplicates(fields, job?.id)
      const approvalKey = vacancyDuplicateApprovalKey(fields, duplicateResult)
      if (approvalKey !== approvedDuplicateReview) {
        setDuplicatePrompt({ result: duplicateResult, approvalKey })
        return
      }
      if (mode === 'team') {
        // The team posts through the database function: no pinning, no editing.
        const result = await teamPostVacancy(fields)
        if (!result.ok) throw new Error(result.error)
      } else if (job) {
        await updateJob(job.id, { ...fields, pinned, extraFields: cleanExtraFields(extraFields) })
      } else {
        await addJob({ ...fields, pinned, extraFields: cleanExtraFields(extraFields) })
      }
      if (!job) resetDraft()
      onSaved()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save vacancy.')
    } finally { setSaving(false) }
  }

  return (
    <>
      <Modal open={open} onClose={onClose} title={job ? 'Edit vacancy' : 'Post vacancy'}>
      <div className="space-y-3">
        {!job && (
          <section className="rounded-2xl border border-brand-200 bg-gradient-to-br from-brand-50 to-indigo-50 p-3 space-y-3">
            <div>
              <div className="font-bold text-slate-900">✨ Fill fields from a vacancy poster or text</div>
              <p className="text-xs text-slate-600 mt-1">OCR runs locally in this browser. It reads the text and shows what it found — you choose what to fill, and nothing is posted until you press Final Submit.</p>
            </div>
            <div className="flex gap-2">
              <Button type="button" variant={sourceMode === 'image' ? 'primary' : 'secondary'} className="flex-1" onClick={() => setSourceMode('image')} disabled={extracting}>
                📷 Upload flyer
              </Button>
              <Button type="button" variant={sourceMode === 'text' ? 'primary' : 'secondary'} className="flex-1" onClick={() => setSourceMode('text')} disabled={extracting}>
                📋 Paste text
              </Button>
            </div>
            {sourceMode === 'image' ? (
              <div className="space-y-2">
                <Input
                  type="file"
                  accept="image/*"
                  aria-label="Upload vacancy flyer or screenshot"
                  onChange={(event) => {
                    setSourceImage(event.target.files?.[0] ?? null)
                    setExtractError(null)
                    setOcrText('')
                  }}
                  disabled={extracting}
                />
                <p className="text-xs text-slate-600">Photo or screenshot · up to 12 MB · supported text is English. The image stays on this device.</p>
                {sourceImage && <p className="text-xs font-semibold text-slate-700 truncate">Selected: {sourceImage.name}</p>}
              </div>
            ) : (
              <Textarea
                rows={5}
                maxLength={20000}
                value={sourceText}
                onChange={(event) => { setSourceText(event.target.value); setExtractError(null) }}
                placeholder="Paste the vacancy poster text here…"
                aria-label="Paste vacancy text for auto-fill"
                disabled={extracting}
              />
            )}
            <Button type="button" className="w-full" variant="secondary" onClick={() => { void readSource() }} disabled={extracting}>
              {extracting ? 'Reading…' : '🔍 Read the text & show what was found'}
            </Button>
            {extracting && (
              <div role="status" className="text-xs font-semibold text-brand-800">
                {extractStatus || 'Reading vacancy source…'}
                {sourceMode === 'image' && <div className="mt-1 h-2 overflow-hidden rounded-full bg-white"><div className="h-full bg-brand-600 transition-all" style={{ width: `${Math.round(extractProgress * 100)}%` }} /></div>}
              </div>
            )}
            {extractError && <p role="alert" className="text-xs font-bold text-red-700">{extractError}</p>}
            {extractNotice && <p role="status" className="text-xs font-semibold text-emerald-800">{extractNotice}</p>}
            {review && (
              <div className="space-y-2 rounded-xl bg-white p-3 ring-1 ring-slate-200">
                <div className="text-sm font-bold text-slate-900">Choose what to fill</div>
                <p className="text-xs text-slate-600">
                  Values are editable — correct anything the paste or scan read wrongly. Only the ticked ones are written
                  into the form. Fields you have already typed start unticked, and HQ text fills the first HQ box without
                  adding new ones.
                </p>
                <div className="space-y-2">
                  {EXTRACTED_FIELDS.map(({ key, label }) => {
                    const value = review.fields[key]
                    if (typeof value !== 'string' || !value.trim()) return null
                    const checked = review.picked[key] === true
                    const typed = draftValue(key).trim().length > 0
                    const long = key === 'description'
                    return (
                      <div key={key} className={`rounded-lg p-2 ring-1 ${checked ? 'bg-slate-50 ring-slate-200' : 'bg-white ring-slate-100'}`}>
                        <label className="flex items-start gap-2">
                          <input
                            type="checkbox"
                            className="mt-1"
                            checked={checked}
                            onChange={(event) => setReview((current) => current
                              ? { ...current, picked: { ...current.picked, [key]: event.target.checked } }
                              : current)}
                          />
                          <span className="min-w-0 flex-1">
                            <span className="text-xs font-bold text-slate-800">{label}</span>
                            {typed && <span className="ml-1 text-[11px] font-semibold text-amber-700">· replaces what you typed</span>}
                          </span>
                        </label>
                        {long
                          ? <Textarea
                              aria-label={`${label} found in the pasted text`}
                              rows={3}
                              className="mt-1.5 w-full text-xs"
                              value={value}
                              onChange={(event) => setReview((current) => current
                                ? { ...current, fields: { ...current.fields, [key]: event.target.value } }
                                : current)}
                            />
                          : <Input
                              aria-label={`${label} found in the pasted text`}
                              className="mt-1.5 w-full text-xs"
                              value={value}
                              onChange={(event) => setReview((current) => current
                                ? { ...current, fields: { ...current.fields, [key]: event.target.value } }
                                : current)}
                            />}
                      </div>
                    )
                  })}

                  {review.extras.length > 0 && (
                    <div className="space-y-2 rounded-lg bg-amber-50/60 p-2 ring-1 ring-amber-200">
                      <div className="text-xs font-bold text-amber-950">
                        Extra details — new fields for this vacancy
                      </div>
                      <p className="text-[11px] font-medium text-amber-900">
                        These lines had no field of their own. Ticked ones are added to the vacancy as their own fields,
                        and everyone can read them. Phone numbers and emails are never accepted here.
                      </p>
                      {review.extras.map((extra, index) => {
                        const problem = extraFieldProblem(extra.label, extra.value)
                        return (
                          <div key={`${extra.label}-${index}`} className="rounded-lg bg-white p-2 ring-1 ring-amber-200">
                            <div className="flex items-start gap-2">
                              <input
                                type="checkbox"
                                className="mt-1"
                                checked={extra.checked}
                                onChange={(event) => setReview((current) => current
                                  ? { ...current, extras: current.extras.map((item, itemIndex) => itemIndex === index ? { ...item, checked: event.target.checked } : item) }
                                  : current)}
                              />
                              <div className="min-w-0 flex-1 space-y-1">
                                <Input
                                  aria-label="Field name"
                                  className="w-full text-xs font-bold"
                                  value={extra.label}
                                  onChange={(event) => setReview((current) => current
                                    ? { ...current, extras: current.extras.map((item, itemIndex) => itemIndex === index ? { ...item, label: event.target.value } : item) }
                                    : current)}
                                />
                                <Input
                                  aria-label={`${extra.label || 'Field'} value`}
                                  className="w-full text-xs"
                                  value={extra.value}
                                  onChange={(event) => setReview((current) => current
                                    ? { ...current, extras: current.extras.map((item, itemIndex) => itemIndex === index ? { ...item, value: event.target.value } : item) }
                                    : current)}
                                />
                                {extra.checked && problem && <div className="text-[11px] font-semibold text-red-700">{problem}</div>}
                              </div>
                              <button
                                type="button"
                                aria-label="Remove this field"
                                className="mt-1 text-xs font-bold text-slate-500 hover:text-red-700"
                                onClick={() => setReview((current) => current
                                  ? { ...current, extras: current.extras.filter((_, itemIndex) => itemIndex !== index) }
                                  : current)}
                              >
                                ✕
                              </button>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
                <div className="flex gap-2">
                  <Button type="button" variant="secondary" className="flex-1" onClick={() => setReview(null)}>
                    Discard
                  </Button>
                  <Button
                    type="button"
                    className="flex-1"
                    onClick={applyReviewedFields}
                    disabled={!EXTRACTED_FIELDS.some(({ key }) => review.picked[key] === true)
                      && !review.extras.some((extra) => extra.checked)}
                  >
                    Fill selected values
                  </Button>
                </div>
              </div>
            )}
            {sourceMode === 'image' && ocrText && (
              <details className="rounded-lg bg-white/80 p-2 text-xs text-slate-700">
                <summary className="cursor-pointer font-semibold">Review the text OCR found</summary>
                <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap font-sans">{ocrText}</pre>
              </details>
            )}
          </section>
        )}
        <div>
          <Label>Title</Label>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Medical Representative" />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <Label>Company</Label>
            <Input value={company} onChange={(e) => setCompany(e.target.value)} />
          </div>
          <div>
            <Label>Category</Label>
            <Select value={category} onChange={(e) => setCategory(e.target.value as Exclude<Job['category'], 'All'>)}>
              {CATEGORIES.filter((c) => c !== 'All').map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </Select>
          </div>
          <div>
            <Label>Manager</Label>
            <Input value={manager} onChange={(e) => setManager(e.target.value)} />
          </div>
          <div>
            <Label>Contact (phone · ABM/ASM)</Label>
            <Input
              type="tel"
              inputMode="numeric"
              pattern="[0-9]*"
              autoComplete="tel"
              value={contact}
              onChange={(e) => changeMobile(e.target.value, setContact, setContactError)}
              placeholder="10-digit mobile number"
              aria-invalid={contactError ? true : undefined}
              aria-describedby={contactError ? 'vacancy-contact-error' : undefined}
              /* Inline style: the shared Input's own border/text classes must lose here. */
              style={contactError ? { borderColor: '#dc2626', color: '#b91c1c', backgroundColor: '#fef2f2' } : undefined}
            />
            {contactError && (
              <p id="vacancy-contact-error" role="alert" className="mt-1.5 text-sm font-bold text-red-700">{contactError}</p>
            )}
          </div>
          <div>
            <Label>Manager alternate number</Label>
            <div className="flex items-stretch">
              <span
                aria-hidden
                className="inline-flex items-center px-2.5 rounded-l-xl border border-r-0 border-slate-200 bg-slate-100 text-slate-700 font-extrabold"
                style={altPhoneError ? { borderColor: '#dc2626', color: '#b91c1c' } : undefined}
              >
                +91
              </span>
              <Input
                type="tel"
                inputMode="numeric"
                pattern="[0-9]*"
                autoComplete="tel"
                value={managerAltPhone}
                onChange={(e) => changeMobile(e.target.value, setManagerAltPhone, setAltPhoneError, true)}
                placeholder="Optional · 10-digit mobile number"
                className="rounded-l-none"
                aria-invalid={altPhoneError ? true : undefined}
                aria-describedby={altPhoneError ? 'vacancy-alt-phone-error' : undefined}
                /* Inline style: the shared Input's own border/text classes must lose here. */
                style={altPhoneError ? { borderColor: '#dc2626', color: '#b91c1c', backgroundColor: '#fef2f2' } : undefined}
              />
            </div>
            {altPhoneError && (
              <p id="vacancy-alt-phone-error" role="alert" className="mt-1.5 text-sm font-bold text-red-700">{altPhoneError}</p>
            )}
          </div>
          <div>
            <Label>Manager email</Label>
            <Input type="email" value={managerEmail} onChange={(e) => setManagerEmail(e.target.value)} placeholder="hr@company.com" />
          </div>
          <div>
            <Label>City</Label>
            <Input value={location} onChange={(e) => setLocation(e.target.value)} />
          </div>
          <div className="sm:col-span-2 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <Label>HQ (headquarters)</Label>
              <Button type="button" variant="secondary" onClick={addHq}>
                + Add HQ
              </Button>
            </div>
            <div className="space-y-2">
              {hqEntries.map((entry, index) => (
                <div key={index} className="flex items-center gap-2">
                  <Input
                    value={entry}
                    onChange={(event) => updateHq(index, event.target.value)}
                    placeholder={index === 0 ? 'Optional · e.g. Hyderabad HO' : `HQ ${index + 1}`}
                    aria-label={`HQ entry ${index + 1}`}
                    maxLength={MAX_HQ_TEXT_LENGTH}
                    aria-invalid={hqError ? true : undefined}
                    aria-describedby={hqError ? 'vacancy-hq-error' : undefined}
                  />
                  {index > 0 && (
                    <Button type="button" variant="ghost" className="shrink-0 px-3" onClick={() => removeHq(index)} aria-label={`Remove HQ ${index + 1}`}>
                      Remove
                    </Button>
                  )}
                </div>
              ))}
            </div>
            <p className="text-xs text-slate-500">Add each head office in its own box. Combined HQ entries can be up to {MAX_HQ_TEXT_LENGTH} characters.</p>
            {hqError && <p id="vacancy-hq-error" role="alert" className="text-sm font-bold text-red-700">{hqError}</p>}
          </div>
          <div>
            <Label>Division</Label>
            <Input value={division} onChange={(e) => setDivision(e.target.value)} placeholder="Optional · e.g. Cardiology" />
          </div>
          <div>
            <Label>Salary</Label>
            <Input value={salary} onChange={(e) => setSalary(e.target.value)} placeholder="₹2-3 LPA" />
          </div>
          <div>
            <Label>Experience</Label>
            <Input value={experience} onChange={(e) => setExperience(e.target.value)} placeholder="0-2 years" />
          </div>
          <div>
            <Label>Qualification</Label>
            <Input value={qualification} onChange={(e) => setQualification(e.target.value)} placeholder="e.g. Any degree / B.Pharm" />
          </div>
          <div>
            <Label>Age limit</Label>
            <Input value={ageLimit} onChange={(e) => setAgeLimit(e.target.value)} placeholder="e.g. Below 25 years" />
          </div>
          <div>
            <Label>Number of vacancies</Label>
            <Input value={vacancyCount} onChange={(e) => setVacancyCount(e.target.value)} placeholder="e.g. 1 position" />
          </div>
          {mode === 'admin' && (
            <div className="flex items-center gap-2 self-end pb-1">
              <input type="checkbox" id="pinned" checked={pinned} onChange={(e) => setPinned(e.target.checked)} />
              <label htmlFor="pinned" className="text-sm font-semibold text-slate-700">Pin to Priority</label>
            </div>
          )}
        </div>
        <div className="rounded-xl ring-1 ring-amber-200 bg-amber-50/40 p-3 space-y-2">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <Label>Job description — one point per line</Label>
            <Badge color="amber">PUBLIC · shown to every user</Badge>
          </div>
          <p className="text-xs font-medium text-amber-900">
            Free users read this description before subscribing, so it must not contain confidential contact details.
            Phone numbers and email addresses are rejected here and by the database — use the Manager, Contact,
            Manager alternate number and Manager email fields above instead.
          </p>
          <Textarea
            rows={6}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={'Field sales in the assigned territory\nDoctor and chemist calls as per the tour plan\nGraduate with 0-3 years of pharma experience'}
          />
          <div className="flex items-center gap-2 flex-wrap">
            <Button
              type="button"
              variant="secondary"
              className="px-3 py-1.5 text-xs"
              onClick={() => setDescription((current) => (current.trim() ? `${current.replace(/\n+$/, '')}\n` : ''))}
            >
              + Add a point
            </Button>
            <span className="text-[11px] text-slate-600">
              {descriptionPoints(description).length} point{descriptionPoints(description).length === 1 ? '' : 's'} · each line becomes a • bullet
            </span>
          </div>
          {descriptionPoints(description).length > 0 && (
            <div className="rounded-lg bg-white ring-1 ring-slate-200 p-2.5">
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">How users will see it</div>
              <ul className="space-y-1">
                {descriptionPoints(description).map((point, index) => (
                  <li key={index} className="flex items-start gap-1.5 text-xs text-slate-800 leading-snug">
                    <span aria-hidden className="text-brand-600 font-extrabold shrink-0">•</span>
                    <span>{point}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
        {mode !== 'team' && (
          <div className="rounded-xl bg-slate-50 p-3 ring-1 ring-slate-200">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="text-sm font-bold text-slate-900">Extra details</div>
                <div className="text-xs text-slate-600">
                  Any field this form does not have — “Territory”, “Joining date”, “Two-wheeler”. Each becomes its own
                  line on the vacancy and is public. {extraFields.length}/{EXTRA_FIELD_LIMIT} used.
                </div>
              </div>
              <Button
                type="button"
                variant="secondary"
                className="px-3 py-1.5 text-xs"
                disabled={extraFields.length >= EXTRA_FIELD_LIMIT}
                onClick={() => setExtraFields((current) => [...current, { label: '', value: '' }])}
              >
                ＋ Add field
              </Button>
            </div>
            {extraFields.length > 0 && (
              <div className="mt-2 space-y-2">
                {extraFields.map((field, index) => {
                  const problem = extraFieldProblem(field.label, field.value)
                  const complete = field.label.trim().length > 0 || field.value.trim().length > 0
                  return (
                    <div key={index} className="rounded-lg bg-white p-2 ring-1 ring-slate-200">
                      <div className="flex items-start gap-2">
                        <div className="grid min-w-0 flex-1 grid-cols-1 gap-1.5 sm:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
                          <Input
                            aria-label={`Extra field ${index + 1} name`}
                            className="w-full text-xs font-bold"
                            placeholder="Field name"
                            value={field.label}
                            maxLength={40}
                            onChange={(event) => setExtraFields((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, label: event.target.value } : item))}
                          />
                          <Input
                            aria-label={`Extra field ${index + 1} value`}
                            className="w-full text-xs"
                            placeholder="Value"
                            value={field.value}
                            maxLength={200}
                            onChange={(event) => setExtraFields((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, value: event.target.value } : item))}
                          />
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          className="shrink-0 px-2.5 py-1.5 text-xs"
                          aria-label={`Remove ${field.label || 'this field'}`}
                          onClick={() => setExtraFields((current) => current.filter((_, itemIndex) => itemIndex !== index))}
                        >
                          ✕
                        </Button>
                      </div>
                      {complete && problem && <div className="mt-1 text-[11px] font-semibold text-red-700">{problem}</div>}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}
        <p className="text-sm font-medium text-slate-700">
          <span className="font-bold">Public to every signed-in user:</span> title, category, city, salary, experience,
          qualification, age limit, number of vacancies, posted date, HQ entries, division, the description above, and
          every extra detail added here.
          <span className="font-bold"> Locked until an active subscription:</span> company name, manager name, manager
          email, contact number (ABM/ASM), and the optional +91 manager alternate number. Free users see blurred
          placeholders only — those values are never sent to them.
        </p>
        {error && <p role="alert" className="text-sm font-bold text-red-800">{error}</p>}
        <Button className="w-full" onClick={() => { void save() }} disabled={saving || extracting}>{saving ? 'Checking and saving…' : job ? 'Save changes' : 'Final Submit'}</Button>
      </div>
      </Modal>
      <Modal open={Boolean(duplicatePrompt)} onClose={discardDraft} title="Review duplicate status">
        {duplicatePrompt && (
          <div className="space-y-4">
            <div className={`rounded-xl p-3 ring-1 ${duplicatePrompt.result.status === 'exact' ? 'bg-red-50 ring-red-200' : duplicatePrompt.result.status === 'possible' || duplicatePrompt.result.status === 'incomplete' ? 'bg-amber-50 ring-amber-200' : 'bg-emerald-50 ring-emerald-200'}`}>
              <div className="font-bold text-slate-900">
                {duplicatePrompt.result.status === 'exact' && 'An exact active vacancy already exists.'}
                {duplicatePrompt.result.status === 'possible' && 'A possible active duplicate was found.'}
                {duplicatePrompt.result.status === 'none' && 'No exact active duplicate was found.'}
                {duplicatePrompt.result.status === 'incomplete' && 'The duplicate check needs more vacancy details.'}
              </div>
              <p className="text-xs text-slate-700 mt-1">
                {duplicatePrompt.result.status === 'exact' && 'Review the existing listing below. Post explicitly to continue, or choose Don’t Post to discard this draft.'}
                {duplicatePrompt.result.status === 'possible' && 'The employer, role, city and matching details overlap. Check whether this is the same active opening.'}
                {duplicatePrompt.result.status === 'none' && 'You may continue to review the form. Nothing has been published yet.'}
                {duplicatePrompt.result.status === 'incomplete' && `Complete title, company, city and category; ${job ? 'Save changes' : 'Final Submit'} will check again before saving.`}
              </p>
            </div>
            {duplicatePrompt.result.matches.length > 0 && (
              <div className="space-y-2">
                {duplicatePrompt.result.matches.map((match) => (
                  <div key={match.id} className="rounded-xl border border-slate-200 p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="font-bold text-sm text-slate-900">{match.title}</div>
                      <Badge color={match.matchType === 'exact' ? 'red' : 'amber'}>{match.matchType === 'exact' ? 'Exact match' : 'Possible match'}</Badge>
                    </div>
                    <div className="text-sm text-slate-700 mt-1">{match.company} · {match.location}</div>
                    <div className="text-xs text-slate-600 mt-1">
                      {[match.category, match.division, match.hq, match.qualification, match.ageLimit, match.vacancyCount, match.experience, match.salary].filter(Boolean).join(' · ')}
                    </div>
                  </div>
                ))}
              </div>
            )}
            <p className="text-xs text-slate-600">This review does not save anything. Choosing <span className="font-bold">Post</span> only approves continuing; review the editable form and press <span className="font-bold">{job ? 'Save changes' : 'Final Submit'}</span> to publish.</p>
            <div className="flex gap-2">
              <Button type="button" variant="secondary" className="flex-1" onClick={discardDraft}>
                Don’t Post
              </Button>
              <Button type="button" className="flex-1" onClick={approvePostChoice}>
                Post
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </>
  )
}
