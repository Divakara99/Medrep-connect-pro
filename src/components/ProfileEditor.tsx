import { forwardRef, useCallback, useImperativeHandle, useRef, useState } from 'react'
import { Button, Input, Label, Select, Textarea, Card, Badge } from './ui'
import { getProfile, newEducation, newExperience, saveProfile, type Education, type Experience, type Profile } from '../data/profile'
import { clearResume, getResume, saveResume, type ResumeRecord } from '../data/resume'
import { updateCurrentPhone } from '../data/auth'

export type ProfileEditorHandle = {
  save: () => Promise<Profile | null>
}

export const ProfileEditor = forwardRef<ProfileEditorHandle, { email: string; phone?: string; onSaved?: (p: Profile) => void }>(function ProfileEditor(
  { email, phone, onSaved },
  ref,
) {
  const [p, setP] = useState<Profile>(() => {
    const saved = getProfile(email)
    return { ...saved, phone: saved.phone || phone }
  })
  const [savedMsg, setSavedMsg] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [resume, setResume] = useState<ResumeRecord | null>(() => getResume(email))
  const [resumeMsg, setResumeMsg] = useState<string | null>(null)
  const resumeInput = useRef<HTMLInputElement | null>(null)

  async function onResumeFile(file: File | undefined) {
    if (!file) return
    setResumeMsg(null)
    const result = await saveResume(email, file)
    if (result.ok) {
      setResume(result.resume)
      setResumeMsg('Resume saved — it will be sent along with your job applications.')
    } else {
      setResumeMsg(result.error)
    }
  }

  function update(patch: Partial<Profile>) {
    setP((prev) => ({ ...prev, ...patch }))
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

    const saved = saveProfile({ ...p, email, phone: phoneResult.phone })
    setP(saved)
    setSavedMsg('Profile saved.')
    setTimeout(() => setSavedMsg(null), 2000)
    onSaved?.(saved)
    return saved
  }, [p, email, onSaved])

  useImperativeHandle(ref, () => ({ save }), [save])

  const split = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean)
  const join = (arr: string[] = []) => arr.join(', ')

  return (
    <div className="space-y-4 pb-4">
      <Card className="p-4 bg-gradient-to-br from-brand-50 to-indigo-50 border-brand-200">
        <div className="flex items-center justify-between gap-2">
          <div>
            <div className="text-[11px] font-bold uppercase tracking-widest text-brand-700">Tagline</div>
            <div className="text-xl font-extrabold text-slate-900">{p.tagline}</div>
            <div className="text-xs text-slate-600">{p.email}</div>
          </div>
          <Badge color="brand">Job Seeker</Badge>
        </div>
      </Card>

      <Card className="p-4 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <div>
            <div className="text-[11px] font-bold uppercase tracking-widest text-slate-500">Resume / CV</div>
            <div className="text-sm text-slate-700">Sent along with your data on every job application (PDF/DOC/DOCX · max 1.5 MB).</div>
          </div>
          <span className="text-2xl">📎</span>
        </div>
        {resume ? (
          <div className="rounded-xl bg-emerald-50 ring-1 ring-emerald-200 p-3 flex items-center gap-3">
            <div className="min-w-0 flex-1">
              <div className="text-sm font-bold text-slate-900 truncate">{resume.fileName}</div>
              <div className="text-xs text-slate-600">{Math.max(1, Math.round(resume.size / 1024))} KB · updated {new Date(resume.updatedAt).toLocaleDateString()}</div>
            </div>
            <a
              href={resume.dataUrl}
              download={resume.fileName}
              className="shrink-0 rounded-xl bg-white ring-1 ring-slate-200 px-3 py-2 text-xs font-bold text-slate-800 hover:bg-slate-50"
            >
              Download
            </a>
            <Button
              variant="secondary"
              className="shrink-0 px-3 py-2 text-xs"
              onClick={() => { clearResume(email); setResume(null); setResumeMsg('Resume removed.') }}
            >
              Remove
            </Button>
          </div>
        ) : (
          <Button variant="secondary" onClick={() => resumeInput.current?.click()}>⬆ Upload resume</Button>
        )}
        <input
          ref={resumeInput}
          type="file"
          accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          className="hidden"
          onChange={(event) => { void onResumeFile(event.target.files?.[0]); event.target.value = '' }}
        />
        {resumeMsg && <p role="status" className="text-xs font-semibold text-slate-700">{resumeMsg}</p>}
      </Card>

      <Card className="p-4 space-y-3">
        <div className="font-bold text-slate-900">Personal</div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <Label>Phone</Label>
            <Input value={p.phone ?? ''} onChange={(e) => update({ phone: e.target.value })} placeholder="10-digit mobile" />
          </div>
          <div>
            <Label>City</Label>
            <Input value={p.city ?? ''} onChange={(e) => update({ city: e.target.value })} placeholder="e.g. Hyderabad" />
          </div>
          <div>
            <Label>State</Label>
            <Input value={p.state ?? ''} onChange={(e) => update({ state: e.target.value })} placeholder="e.g. Telangana" />
          </div>
          <div>
            <Label>Date of birth</Label>
            <Input type="date" value={p.dob ?? ''} onChange={(e) => update({ dob: e.target.value })} />
          </div>
          <div>
            <Label>Gender</Label>
            <Select value={p.gender ?? ''} onChange={(e) => update({ gender: e.target.value as Profile['gender'] })}>
              <option value="">Select</option>
              <option>Male</option>
              <option>Female</option>
              <option>Other</option>
            </Select>
          </div>
          <div>
            <Label>Expected CTC</Label>
            <Input value={p.ctc ?? ''} onChange={(e) => update({ ctc: e.target.value })} placeholder="e.g. 3 LPA" />
          </div>
          <div>
            <Label>Notice period</Label>
            <Input value={p.noticePeriod ?? ''} onChange={(e) => update({ noticePeriod: e.target.value })} placeholder="e.g. Immediate / 30 days" />
          </div>
        </div>

        <div>
          <Label>Languages (comma separated)</Label>
          <Input value={join(p.languages)} onChange={(e) => update({ languages: split(e.target.value) })} placeholder="English, Telugu, Hindi" />
        </div>
        <div>
          <Label>Skills (comma separated)</Label>
          <Input value={join(p.skills)} onChange={(e) => update({ skills: split(e.target.value) })} placeholder="Sales, RCPA, Detailing, Excel" />
        </div>
        <div>
          <Label>Preferred roles (comma separated)</Label>
          <Input value={join(p.preferredRoles)} onChange={(e) => update({ preferredRoles: split(e.target.value) })} placeholder="MR, ABM, Field Sales" />
        </div>
        <div>
          <Label>Bio</Label>
          <Textarea rows={3} value={p.bio ?? ''} onChange={(e) => update({ bio: e.target.value })} placeholder="A short summary about you…" />
        </div>
      </Card>

      <Card className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="font-bold text-slate-900">Education</div>
          <Button variant="secondary" onClick={addEducation}>+ Add</Button>
        </div>
        {p.education.length === 0 && <div className="text-sm text-slate-500">Add your degree(s).</div>}
        {p.education.map((e) => (
          <div key={e.id} className="rounded-xl ring-1 ring-slate-200 p-3 space-y-2">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <Input placeholder="Degree" value={e.degree} onChange={(ev) => updateEdu(e.id, { degree: ev.target.value })} />
              <Input placeholder="Field" value={e.field} onChange={(ev) => updateEdu(e.id, { field: ev.target.value })} />
              <Input placeholder="Institution" className="col-span-2" value={e.institution} onChange={(ev) => updateEdu(e.id, { institution: ev.target.value })} />
              <Input placeholder="Year" value={e.year} onChange={(ev) => updateEdu(e.id, { year: ev.target.value })} />
              <div className="flex justify-end">
                <Button variant="ghost" onClick={() => removeEdu(e.id)}>Remove</Button>
              </div>
            </div>
          </div>
        ))}
      </Card>

      <Card className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="font-bold text-slate-900">Experience</div>
          <Button variant="secondary" onClick={addExp}>+ Add</Button>
        </div>
        {p.experience.length === 0 && <div className="text-sm text-slate-500">Add work experience (optional for freshers).</div>}
        {p.experience.map((e) => (
          <div key={e.id} className="rounded-xl ring-1 ring-slate-200 p-3 space-y-2">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <Input placeholder="Title" value={e.title} onChange={(ev) => updateExp(e.id, { title: ev.target.value })} />
              <Input placeholder="Company" value={e.company} onChange={(ev) => updateExp(e.id, { company: ev.target.value })} />
              <Input placeholder="Duration" className="col-span-2" value={e.duration} onChange={(ev) => updateExp(e.id, { duration: ev.target.value })} />
              <Textarea placeholder="Description" className="col-span-2" rows={2} value={e.description} onChange={(ev) => updateExp(e.id, { description: ev.target.value })} />
              <div className="col-span-2 flex justify-end">
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
