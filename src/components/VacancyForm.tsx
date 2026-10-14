import { useState } from 'react'
import { Badge, Button, Input, Label, Modal, Select, Textarea } from './ui'
import { addJob, CATEGORIES, descriptionPoints, updateJob, type Job } from '../data/jobs'
import { findConfidentialContact } from '../data/jobDescription'
import { digitsOnly, hasNonPhoneCharacters, mobileNumberProblem, MOBILE_DIGITS, MOBILE_MAX_DIGITS, MAX_HQ_TEXT_LENGTH, headquartersProblem, normalizeIndianMobile, parseHeadquarters, serializeHeadquarters } from '../data/vacancyRules'
import { teamPostVacancy } from '../data/vacancyTeam'
import { extractVacancyFields, type VacancyExtraction } from '../data/vacancyExtraction'
import { readVacancyImageText } from '../data/vacancyOcr'
import { checkVacancyDuplicates, vacancyDuplicateApprovalKey, type VacancyDuplicateCheck, type VacancyDuplicateFields } from '../data/vacancyDuplicates'

/**
 * The vacancy form, shared by the administrator (post, edit, pin) and the
 * vacancy team (post only). The database checks the same rules either way.
 */

export function VacancyForm({ job, open, onClose, onSaved, mode = 'admin' }: { job: Job | null; open: boolean; onClose: () => void; onSaved: () => void; mode?: 'admin' | 'team' }) {
  const [title, setTitle] = useState(job?.title ?? '')
  const [company, setCompany] = useState(job?.company ?? '')
  const [manager, setManager] = useState(job?.manager ?? '')
  // Mobile fields hold digits only — any formatting already on an older
  // vacancy is dropped here, so what is saved is always a clean number.
  const [contact, setContact] = useState(() => digitsOnly(job?.contact ?? ''))
  const [managerAltPhone, setManagerAltPhone] = useState(() => normalizeIndianMobile(job?.managerAltPhone ?? ''))
  // Shown inside the field itself (red border + red text), never in a list
  // below the form.
  const [contactError, setContactError] = useState<string | null>(null)
  const [altPhoneError, setAltPhoneError] = useState<string | null>(null)
  const [managerEmail, setManagerEmail] = useState(job?.managerEmail ?? '')
  const [location, setLocation] = useState(job?.location ?? '')
  const [hqEntries, setHqEntries] = useState(() => {
    const savedEntries = parseHeadquarters(job?.hq)
    return savedEntries.length > 0 ? savedEntries : ['']
  })
  const [hqError, setHqError] = useState<string | null>(null)
  const [division, setDivision] = useState(job?.division ?? '')
  const [category, setCategory] = useState<Exclude<Job['category'], 'All'>>(job?.category ?? 'MR')
  const [salary, setSalary] = useState(job?.salary ?? '')
  const [experience, setExperience] = useState(job?.experience ?? '')
  const [qualification, setQualification] = useState(job?.qualification ?? '')
  const [ageLimit, setAgeLimit] = useState(job?.ageLimit ?? '')
  const [vacancyCount, setVacancyCount] = useState(job?.vacancyCount ?? '')
  const [description, setDescription] = useState(job?.description ?? '')
  const [pinned, setPinned] = useState(job?.pinned ?? false)
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
  const [duplicateChecking, setDuplicateChecking] = useState(false)
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

  function applyExtractedFields(fields: VacancyExtraction) {
    if (fields.title?.trim()) setTitle(fields.title.trim())
    if (fields.company?.trim()) setCompany(fields.company.trim())
    if (fields.manager?.trim()) setManager(fields.manager.trim())
    if (fields.contact?.trim()) setContact(digitsOnly(fields.contact).slice(0, MOBILE_MAX_DIGITS))
    if (fields.managerAltPhone?.trim()) setManagerAltPhone(normalizeIndianMobile(fields.managerAltPhone).slice(0, MOBILE_DIGITS))
    if (fields.managerEmail?.trim()) setManagerEmail(fields.managerEmail.trim())
    if (fields.location?.trim()) setLocation(fields.location.trim())
    if (fields.hq?.trim()) {
      const entries = parseHeadquarters(fields.hq)
      setHqEntries(entries.length ? entries : [''])
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

  async function openDuplicateReview(fields: VacancyDuplicateFields) {
    setDuplicateChecking(true)
    setError(null)
    try {
      const result = await checkVacancyDuplicates(fields, job?.id)
      setDuplicatePrompt({ result, approvalKey: vacancyDuplicateApprovalKey(fields, result) })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not check existing vacancies.')
    } finally {
      setDuplicateChecking(false)
    }
  }

  async function extractAndReview() {
    setExtractError(null)
    setError(null)
    setExtractNotice(null)
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
      const fields = { ...collectDraftFields(), ...extracted }
      applyExtractedFields(extracted)
      setApprovedDuplicateReview(null)
      const count = Object.keys(extracted).length
      setExtractNotice(count > 0
        ? `Auto-filled ${count} field${count === 1 ? '' : 's'}. Review each value before posting.`
        : 'No fields were confidently detected. Review the OCR text and complete the form manually.')
      await openDuplicateReview(fields)
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
    setDuplicateChecking(false)
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
        await updateJob(job.id, { ...fields, pinned })
      } else {
        await addJob({ ...fields, pinned })
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
              <div className="font-bold text-slate-900">✨ Auto-fill from a vacancy poster or text</div>
              <p className="text-xs text-slate-600 mt-1">OCR runs locally in this browser. It only drafts form fields—nothing is posted until you review and press Final Submit.</p>
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
            <Button type="button" className="w-full" variant="secondary" onClick={() => { void extractAndReview() }} disabled={extracting || duplicateChecking}>
              {extracting ? 'Reading and filling…' : '✨ Extract fields & check duplicates'}
            </Button>
            {extracting && (
              <div role="status" className="text-xs font-semibold text-brand-800">
                {extractStatus || 'Reading vacancy source…'}
                {sourceMode === 'image' && <div className="mt-1 h-2 overflow-hidden rounded-full bg-white"><div className="h-full bg-brand-600 transition-all" style={{ width: `${Math.round(extractProgress * 100)}%` }} /></div>}
              </div>
            )}
            {extractError && <p role="alert" className="text-xs font-bold text-red-700">{extractError}</p>}
            {extractNotice && <p role="status" className="text-xs font-semibold text-emerald-800">{extractNotice}</p>}
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
        <p className="text-sm font-medium text-slate-700">
          <span className="font-bold">Public to every signed-in user:</span> title, category, city, salary, experience,
          qualification, age limit, number of vacancies, posted date, HQ entries, division, and the description above.
          <span className="font-bold"> Locked until an active subscription:</span> company name, manager name, manager
          email, contact number (ABM/ASM), and the optional +91 manager alternate number. Free users see blurred
          placeholders only — those values are never sent to them.
        </p>
        {error && <p role="alert" className="text-sm font-bold text-red-800">{error}</p>}
        <Button className="w-full" onClick={() => { void save() }} disabled={saving || duplicateChecking || extracting}>{saving ? 'Checking and saving…' : job ? 'Save changes' : 'Final Submit'}</Button>
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
