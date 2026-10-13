import { useState } from 'react'
import { Badge, Button, Input, Label, Modal, Select, Textarea } from './ui'
import { addJob, CATEGORIES, descriptionPoints, updateJob, type Job } from '../data/jobs'
import { findConfidentialContact } from '../data/jobDescription'
import { teamPostVacancy } from '../data/vacancyTeam'

/**
 * The vacancy form, shared by the administrator (post, edit, pin) and the
 * vacancy team (post only). The database checks the same rules either way.
 */

export function VacancyForm({ job, open, onClose, onSaved, mode = 'admin' }: { job: Job | null; open: boolean; onClose: () => void; onSaved: () => void; mode?: 'admin' | 'team' }) {
  const [title, setTitle] = useState(job?.title ?? '')
  const [company, setCompany] = useState(job?.company ?? '')
  const [manager, setManager] = useState(job?.manager ?? '')
  const [contact, setContact] = useState(job?.contact ?? '')
  const [managerAltPhone, setManagerAltPhone] = useState(job?.managerAltPhone ?? '')
  const [managerEmail, setManagerEmail] = useState(job?.managerEmail ?? '')
  const [location, setLocation] = useState(job?.location ?? '')
  const [hq, setHq] = useState(job?.hq ?? '')
  const [division, setDivision] = useState(job?.division ?? '')
  const [category, setCategory] = useState<Exclude<Job['category'], 'All'>>(job?.category ?? 'MR')
  const [salary, setSalary] = useState(job?.salary ?? '')
  const [experience, setExperience] = useState(job?.experience ?? '')
  const [description, setDescription] = useState(job?.description ?? '')
  const [pinned, setPinned] = useState(job?.pinned ?? false)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  async function save() {
    if (!title || !company || !location) {
      setError('Title, company, and location are required.')
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
      const fields = { title, company, manager, contact, managerAltPhone, managerEmail, location, hq, division, category, salary, experience, description }
      if (mode === 'team') {
        // The team posts through the database function: no pinning, no editing.
        const result = await teamPostVacancy(fields)
        if (!result.ok) throw new Error(result.error)
      } else if (job) {
        await updateJob(job.id, { ...fields, pinned })
      } else {
        await addJob({ ...fields, pinned })
      }
      onSaved()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save vacancy.')
    } finally { setSaving(false) }
  }

  return (
    <Modal open={open} onClose={onClose} title={job ? 'Edit vacancy' : 'Post vacancy'}>
      <div className="space-y-3">
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
            <Input value={contact} onChange={(e) => setContact(e.target.value)} placeholder="+91-…" />
          </div>
          <div>
            <Label>Manager alternate number</Label>
            <div className="flex items-stretch">
              <span aria-hidden className="inline-flex items-center px-2.5 rounded-l-xl border border-r-0 border-slate-200 bg-slate-100 text-slate-700 font-extrabold">(+)</span>
              <Input
                value={managerAltPhone}
                onChange={(e) => setManagerAltPhone(e.target.value)}
                placeholder="Optional · +91-…"
                className="rounded-l-none"
              />
            </div>
          </div>
          <div>
            <Label>Manager email</Label>
            <Input type="email" value={managerEmail} onChange={(e) => setManagerEmail(e.target.value)} placeholder="hr@company.com" />
          </div>
          <div>
            <Label>City</Label>
            <Input value={location} onChange={(e) => setLocation(e.target.value)} />
          </div>
          <div>
            <Label>HQ</Label>
            <Input value={hq} onChange={(e) => setHq(e.target.value)} placeholder="Optional · e.g. Hyderabad HO" />
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
              {descriptionPoints(description).length} point{descriptionPoints(description).length === 1 ? '' : 's'} · each line becomes a (+) bullet
            </span>
          </div>
          {descriptionPoints(description).length > 0 && (
            <div className="rounded-lg bg-white ring-1 ring-slate-200 p-2.5">
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">How users will see it</div>
              <ul className="space-y-1">
                {descriptionPoints(description).map((point, index) => (
                  <li key={index} className="flex items-start gap-1.5 text-xs text-slate-800 leading-snug">
                    <span aria-hidden className="text-brand-600 font-extrabold shrink-0">(+)</span>
                    <span>{point}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
        <p className="text-sm font-medium text-slate-700">
          <span className="font-bold">Public to every signed-in user:</span> title, category, city, salary, experience,
          posted date and the description above.
          <span className="font-bold"> Locked until an active subscription:</span> company name, manager name, manager
          email, contact number (ABM/ASM), the optional (+) manager alternate number, HQ and division. Free users see
          blurred placeholders only — those values are never sent to them.
        </p>
        {error && <p role="alert" className="text-sm font-bold text-red-800">{error}</p>}
        <Button className="w-full" onClick={() => { void save() }} disabled={saving}>{saving ? 'Saving securely…' : job ? 'Save changes' : 'Post vacancy'}</Button>
      </div>
    </Modal>
  )
}
