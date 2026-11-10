import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState, type ChangeEvent } from 'react'
import { Button, Input, Select, Textarea, Card, Badge } from './ui'
import { deleteProfilePhoto, profilePhotoUrl, uploadProfilePhoto } from '../data/profilePhoto'
import { getProfile, newEducation, newExperience, refreshProfile, saveProfile, profileCompletionIssues, type Education, type Experience, type Profile } from '../data/profile'
import { updateCurrentPhone } from '../data/auth'
import type { ResumeRecord } from '../data/resume'
import { ResumeCard } from './ResumeCard'
import { MAX_ADDRESS_LENGTH, addressProblem } from '../data/userAddress'

export type ProfileEditorHandle = {
  save: () => Promise<Profile | null>
}

export const ProfileEditor = forwardRef<
  ProfileEditorHandle,
  {
    email: string
    phone?: string
    onSaved?: (p: Profile) => void
    onPhotoSaved?: (url: string) => void
    onResumeChange?: (resume: ResumeRecord | null) => void
  }
>(function ProfileEditor(
  { email, phone, onSaved, onPhotoSaved, onResumeChange },
  ref,
) {
  const [p, setP] = useState<Profile>(() => {
    const saved = getProfile(email)
    return { ...saved, phone: saved.phone || phone }
  })
  const [savedMsg, setSavedMsg] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [photoUrl, setPhotoUrl] = useState<string | null>(null)
  const [photoBusy, setPhotoBusy] = useState(false)
  const [photoError, setPhotoError] = useState<string | null>(null)
  const photoInput = useRef<HTMLInputElement>(null)
  // Never overwrite fields the user has already started typing into.
  const dirty = useRef(false)

  // The profile is stored online, so pull this account's copy when the editor
  // opens rather than trusting whatever the previous screen had in memory.
  useEffect(() => {
    let alive = true
    refreshProfile(email).then((remote) => {
      if (!alive || dirty.current) return
      setP((prev) => ({ ...remote, phone: prev.phone || remote.phone || phone }))
    })
    return () => { alive = false }
  }, [email, phone])

  useEffect(() => {
    let alive = true
    if (!p.photoPath) return () => { alive = false }
    profilePhotoUrl(p.photoPath).then((url) => {
      if (alive) setPhotoUrl(url)
    })
    return () => { alive = false }
  }, [p.photoPath])

  function update(patch: Partial<Profile>) {
    dirty.current = true
    setP((prev) => ({ ...prev, ...patch }))
  }

  async function changePhoto(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0]
    event.currentTarget.value = ''
    if (!file || photoBusy) return
    setPhotoBusy(true)
    setPhotoError(null)
    setSaveError(null)
    const oldPath = p.photoPath ?? ''
    let uploaded
    try {
      uploaded = await uploadProfilePhoto(file)
    } catch (error) {
      setPhotoError(error instanceof Error ? error.message : 'The profile photo could not be uploaded.')
      setPhotoBusy(false)
      return
    }
    if (!uploaded.ok) {
      setPhotoError(uploaded.error)
      setPhotoBusy(false)
      return
    }
    setPhotoUrl(uploaded.url)
    try {
      // Save only the photo field against the server copy, so other unsaved
      // form edits are not unexpectedly committed by choosing an image.
      const remote = await refreshProfile(email)
      const saved = await saveProfile({ ...remote, photoPath: uploaded.path })
      setP((previous) => ({ ...previous, photoPath: saved.photoPath }))
      onPhotoSaved?.(uploaded.url)
      if (oldPath && oldPath !== uploaded.path) await deleteProfilePhoto(oldPath)
      setSavedMsg('Profile photo updated.')
      window.setTimeout(() => setSavedMsg(null), 2500)
    } catch (error) {
      await deleteProfilePhoto(uploaded.path)
      setPhotoUrl(oldPath ? await profilePhotoUrl(oldPath) : null)
      setPhotoError(error instanceof Error ? error.message : 'The profile photo could not be saved.')
    } finally {
      setPhotoBusy(false)
    }
  }

  function addEducation() {
    update({ education: [...p.education, newEducation()] })
  }
  function updateEdu(id: string, patch: Partial<Education>) {
    update({ education: p.education.map((e) => (e.id === id ? { ...e, ...patch } : e)) })
  }
  function removeEdu(id: string) {
    update({ education: p.education.filter((e) => e.id !== id) })
  }

  function addExp() {
    update({ experience: [...p.experience, newExperience()] })
  }
  function updateExp(id: string, patch: Partial<Experience>) {
    update({ experience: p.experience.map((e) => (e.id === id ? { ...e, ...patch } : e)) })
  }
  function removeExp(id: string) {
    update({ experience: p.experience.filter((e) => e.id !== id) })
  }

  const save = useCallback(async (): Promise<Profile | null> => {
    setSaveError(null)
    setSavedMsg(null)
    const phoneResult = await updateCurrentPhone(p.phone)
    if (!phoneResult.ok) {
      setSaveError(phoneResult.error)
      return null
    }

    try {
      const saved = await saveProfile({ ...p, email, phone: phoneResult.phone })
      dirty.current = false
      setP(saved)
      setSavedMsg('Profile saved.')
      setTimeout(() => setSavedMsg(null), 2000)
      onSaved?.(saved)
      return saved
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Your profile could not be saved online.')
      return null
    }
  }, [p, email, onSaved])

  useImperativeHandle(ref, () => ({ save }), [save])

  const split = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean)
  const join = (arr: string[] = []) => arr.join(', ')
  const completionIssues = profileCompletionIssues(p)

  return (
    <div className="space-y-4 pb-4">
      <Card className="p-4 bg-gradient-to-br from-brand-50 to-indigo-50 border-brand-200">
        <div className="flex items-center gap-3">
          <div className="relative h-16 w-16 shrink-0">
            {photoUrl ? (
              <img src={photoUrl} alt="Your profile" className="h-16 w-16 rounded-2xl object-cover ring-2 ring-white shadow" />
            ) : (
              <div className="grid h-16 w-16 place-items-center rounded-2xl bg-gradient-to-br from-brand-500 to-indigo-700 text-2xl font-extrabold text-white ring-2 ring-white shadow">
                {p.email.slice(0, 1).toUpperCase() || 'U'}
              </div>
            )}
            <button
              type="button"
              onClick={() => photoInput.current?.click()}
              disabled={photoBusy}
              aria-label={photoBusy ? 'Uploading profile photo' : 'Upload or change profile photo'}
              title="Upload or change profile photo"
              className="absolute -bottom-1.5 -right-1.5 grid h-7 w-7 place-items-center rounded-full bg-white text-brand-700 shadow ring-1 ring-brand-200 disabled:opacity-60"
            >
              <PencilIcon />
            </button>
            <input ref={photoInput} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={changePhoto} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-bold text-slate-900">Profile photo</div>
            <div className="text-xs text-slate-600">Shown on your Account</div>
            <div className="mt-1 text-[11px] text-slate-500">JPG, PNG or WEBP · up to 5 MB</div>
          </div>
        </div>
        {photoBusy && <p className="mt-2 text-xs font-semibold text-brand-700" role="status">Uploading profile photo…</p>}
        {photoError && <p className="mt-2 text-xs font-semibold text-red-700" role="alert">{photoError}</p>}
      </Card>

      <Card className={`p-4 space-y-2 ${completionIssues.length === 0 ? 'border-emerald-200 bg-emerald-50/40' : 'border-amber-200 bg-amber-50/40'}`}>
        <div className="flex items-center justify-between gap-2">
          <div className="font-bold text-slate-900">Application profile</div>
          <Badge color={completionIssues.length === 0 ? 'green' : 'amber'}>
            {completionIssues.length === 0 ? 'Ready to apply' : `${completionIssues.length} required item${completionIssues.length === 1 ? '' : 's'} left`}
          </Badge>
        </div>
        {completionIssues.length > 0 ? (
          <>
            <p className="text-xs text-slate-700">Complete these details before applying:</p>
            <ul className="list-disc pl-5 space-y-1 text-xs font-medium text-slate-700" aria-live="polite">
              {completionIssues.map((issue) => <li key={issue}>{issue}</li>)}
            </ul>
          </>
        ) : (
          <p className="text-xs text-emerald-800">Your required details are complete. Work experience is optional for freshers; DOB, gender, CTC, notice period, and resume are optional.</p>
        )}
      </Card>

      <ResumeCard onResumeChange={onResumeChange} />

      <Card className="p-4 space-y-3">
        <div className="font-bold text-slate-900">Personal</div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <EditLabel label="Phone" inputId="profile-phone" />
            <Input id="profile-phone" value={p.phone ?? ''} onChange={(e) => update({ phone: e.target.value })} placeholder="10-digit mobile" />
          </div>
          <div>
            <EditLabel label="City" inputId="profile-city" />
            <Input id="profile-city" value={p.city ?? ''} onChange={(e) => update({ city: e.target.value })} placeholder="e.g. Hyderabad" />
          </div>
          <div>
            <EditLabel label="State" inputId="profile-state" />
            <Input id="profile-state" value={p.state ?? ''} onChange={(e) => update({ state: e.target.value })} placeholder="e.g. Telangana" />
          </div>
          <div className="sm:col-span-2">
            <EditLabel label="Address (optional)" inputId="profile-address" />
            <Textarea
              id="profile-address"
              rows={2}
              maxLength={MAX_ADDRESS_LENGTH}
              value={p.address ?? ''}
              onChange={(e) => update({ address: e.target.value })}
              placeholder="House / street, area, PIN code — shown to you and to the administrator only"
            />
            {addressProblem(p.address ?? '') && (
              <div className="mt-1 text-xs font-semibold text-red-700">{addressProblem(p.address ?? '')}</div>
            )}
          </div>
          <div>
            <EditLabel label="Date of birth" inputId="profile-dob" />
            <Input id="profile-dob" type="date" value={p.dob ?? ''} onChange={(e) => update({ dob: e.target.value })} />
          </div>
          <div>
            <EditLabel label="Gender" inputId="profile-gender" />
            <Select id="profile-gender" value={p.gender ?? ''} onChange={(e) => update({ gender: e.target.value as Profile['gender'] })}>
              <option value="">Select</option>
              <option>Male</option>
              <option>Female</option>
              <option>Other</option>
            </Select>
          </div>
          <div>
            <EditLabel label="Expected CTC" inputId="profile-ctc" />
            <Input id="profile-ctc" value={p.ctc ?? ''} onChange={(e) => update({ ctc: e.target.value })} placeholder="e.g. 3 LPA" />
          </div>
          <div>
            <EditLabel label="Notice period" inputId="profile-notice" />
            <Input id="profile-notice" value={p.noticePeriod ?? ''} onChange={(e) => update({ noticePeriod: e.target.value })} placeholder="e.g. Immediate / 30 days" />
          </div>
        </div>

        <div>
          <EditLabel label="Languages (comma separated)" inputId="profile-languages" />
          <Input id="profile-languages" value={join(p.languages)} onChange={(e) => update({ languages: split(e.target.value) })} placeholder="English, Telugu, Hindi" />
        </div>
        <div>
          <EditLabel label="Skills (comma separated)" inputId="profile-skills" />
          <Input id="profile-skills" value={join(p.skills)} onChange={(e) => update({ skills: split(e.target.value) })} placeholder="Sales, RCPA, Detailing, Excel" />
        </div>
        <div>
          <EditLabel label="Preferred roles (comma separated)" inputId="profile-roles" />
          <Input id="profile-roles" value={join(p.preferredRoles)} onChange={(e) => update({ preferredRoles: split(e.target.value) })} placeholder="MR, ABM, Field Sales" />
        </div>
        <div>
          <EditLabel label="Bio" inputId="profile-bio" />
          <Textarea id="profile-bio" rows={3} value={p.bio ?? ''} onChange={(e) => update({ bio: e.target.value })} placeholder="A short summary about you…" />
        </div>
      </Card>

      <Card className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="font-bold text-slate-900">Education</div>
          <Button variant="secondary" onClick={addEducation}>+ Add</Button>
        </div>
        {p.education.length === 0 && <div className="text-xs text-slate-500">Add your degree(s).</div>}
        {p.education.map((e) => (
          <div key={e.id} className="rounded-xl ring-1 ring-slate-200 p-3 space-y-2">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <div><EditLabel label="Degree" inputId={`education-${e.id}-degree`} /><Input id={`education-${e.id}-degree`} placeholder="Degree" value={e.degree} onChange={(ev) => updateEdu(e.id, { degree: ev.target.value })} /></div>
              <div><EditLabel label="Field" inputId={`education-${e.id}-field`} /><Input id={`education-${e.id}-field`} placeholder="Field" value={e.field} onChange={(ev) => updateEdu(e.id, { field: ev.target.value })} /></div>
              <div className="sm:col-span-2"><EditLabel label="Institution" inputId={`education-${e.id}-institution`} /><Input id={`education-${e.id}-institution`} placeholder="Institution" value={e.institution} onChange={(ev) => updateEdu(e.id, { institution: ev.target.value })} /></div>
              <div><EditLabel label="Year" inputId={`education-${e.id}-year`} /><Input id={`education-${e.id}-year`} placeholder="Year" value={e.year} onChange={(ev) => updateEdu(e.id, { year: ev.target.value })} /></div>
              <div className="flex items-end justify-end"><Button variant="ghost" onClick={() => removeEdu(e.id)}>Remove</Button></div>
            </div>
          </div>
        ))}
      </Card>

      <Card className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="font-bold text-slate-900">Experience</div>
          <Button variant="secondary" onClick={addExp}>+ Add</Button>
        </div>
        {p.experience.length === 0 && <div className="text-xs text-slate-500">Add work experience (optional for freshers).</div>}
        {p.experience.map((e) => (
          <div key={e.id} className="rounded-xl ring-1 ring-slate-200 p-3 space-y-2">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <div><EditLabel label="Title" inputId={`experience-${e.id}-title`} /><Input id={`experience-${e.id}-title`} placeholder="Title" value={e.title} onChange={(ev) => updateExp(e.id, { title: ev.target.value })} /></div>
              <div><EditLabel label="Company" inputId={`experience-${e.id}-company`} /><Input id={`experience-${e.id}-company`} placeholder="Company" value={e.company} onChange={(ev) => updateExp(e.id, { company: ev.target.value })} /></div>
              <div className="sm:col-span-2"><EditLabel label="Duration" inputId={`experience-${e.id}-duration`} /><Input id={`experience-${e.id}-duration`} placeholder="Duration" value={e.duration} onChange={(ev) => updateExp(e.id, { duration: ev.target.value })} /></div>
              <div className="sm:col-span-2"><EditLabel label="Description" inputId={`experience-${e.id}-description`} /><Textarea id={`experience-${e.id}-description`} rows={2} value={e.description} onChange={(ev) => updateExp(e.id, { description: ev.target.value })} /></div>
              <div className="sm:col-span-2 flex justify-end">
                <Button variant="ghost" onClick={() => removeExp(e.id)}>Remove</Button>
              </div>
            </div>
          </div>
        ))}
      </Card>

      {/* Inline save status message above the sticky bar */}
      {saveError && (
        <div className="text-center text-sm text-red-700 font-semibold py-1" role="alert">{saveError}</div>
      )}
      {savedMsg && (
        <div className="text-center text-sm text-emerald-700 font-semibold py-1">{savedMsg}</div>
      )}
    </div>
  )
})

function EditLabel({ label, inputId }: { label: string; inputId: string }) {
  return (
    <div className="mb-1 flex items-center justify-between gap-2">
      <label htmlFor={inputId} className="text-sm font-bold tracking-wide text-slate-700">{label}</label>
      <button
        type="button"
        aria-label={`Edit ${label}`}
        title={`Edit ${label}`}
        onClick={() => document.getElementById(inputId)?.focus()}
        className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-brand-50 text-brand-700 ring-1 ring-brand-100 hover:bg-brand-100 active:scale-95"
      >
        <PencilIcon />
      </button>
    </div>
  )
}

function PencilIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m16 4 4 4M4 20l4-.8L19 8a2.1 2.1 0 0 0-3-3L5 16l-1 4Z" />
    </svg>
  )
}
