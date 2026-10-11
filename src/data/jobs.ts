import { read, write } from './storage'
import { broadcast } from './notifications'

export type JobCategory =
  | 'MR'
  | 'ABM'
  | 'Part-time'
  | 'E-commerce'
  | 'Finance'
  | 'Banking'
  | 'IT'
  | 'Healthcare'
  | 'Insurance'
  | 'FMCG'
  | 'Field'
  | 'All'

export const CATEGORIES: JobCategory[] = [
  'All',
  'MR',
  'ABM',
  'Part-time',
  'E-commerce',
  'Finance',
  'Banking',
  'IT',
  'Healthcare',
  'Insurance',
  'FMCG',
  'Field',
]

// Priority order for "MR-first feed"
export const CATEGORY_PRIORITY: Record<JobCategory, number> = {
  MR: 0,
  ABM: 1,
  Healthcare: 2,
  Field: 3,
  FMCG: 4,
  'Part-time': 5,
  'E-commerce': 6,
  Finance: 7,
  Banking: 8,
  IT: 9,
  Insurance: 10,
  All: 99,
}

export type Job = {
  id: string
  title: string
  company: string
  manager?: string
  contact?: string
  managerEmail?: string
  location: string
  category: Exclude<JobCategory, 'All'>
  salary?: string
  experience?: string
  description?: string
  pinned?: boolean
  postedAt: number
  postedBy?: string
}

const JOBS_KEY = 'mrc_jobs_v1'

function jid() {
  return 'j_' + Math.random().toString(36).slice(2, 10)
}

const DEFAULT_JOBS: Job[] = [
  {
    id: jid(),
    title: 'Medical Representative (MR)',
    company: 'Apex Pharma Pvt Ltd',
    manager: 'Ravi Kumar',
    contact: '+91-98XXX-11111',
    managerEmail: 'ravi.kumar@apexpharma.example',
    location: 'Hyderabad, Telangana',
    category: 'MR',
    salary: '₹2.4 – 3.6 LPA',
    experience: '0–2 years',
    description:
      'Field MR for cardio-diabetic division. Doctor visits, chemist follow-ups, stockist coordination. Bike + fuel allowance.',
    pinned: true,
    postedAt: Date.now() - 2 * 3600_000,
    postedBy: 'admin',
  },
  {
    id: jid(),
    title: 'Area Business Manager (ABM)',
    company: 'SunHealth Lifesciences',
    manager: 'Priya Sharma',
    contact: '+91-98XXX-22222',
    managerEmail: 'priya.sharma@sunhealth.example',
    location: 'Vijayawada, AP',
    category: 'ABM',
    salary: '₹6 – 9 LPA',
    experience: '3–6 years',
    description: 'Lead a team of 6 MRs; HQ target delivery, RCPA, new product launches.',
    pinned: true,
    postedAt: Date.now() - 8 * 3600_000,
    postedBy: 'admin',
  },
  {
    id: jid(),
    title: 'Medical Representative — GP Division',
    company: 'Curewell Remedies',
    manager: 'Suresh G.',
    contact: '+91-98XXX-33333',
    managerEmail: 'suresh.g@curewell.example',
    location: 'Bengaluru, Karnataka',
    category: 'MR',
    salary: '₹2.2 – 3.2 LPA',
    experience: '0–3 years',
    description: 'GP and pediatric division; daily reporting via SFA app.',
    pinned: false,
    postedAt: Date.now() - 20 * 3600_000,
    postedBy: 'admin',
  },
  {
    id: jid(),
    title: 'Field Sales Executive',
    company: 'Bharat FMCG Distributors',
    manager: 'Anil Reddy',
    contact: '+91-98XXX-44444',
    managerEmail: 'anil.reddy@bharatfmcg.example',
    location: 'Chennai, Tamil Nadu',
    category: 'FMCG',
    salary: '₹1.8 – 2.8 LPA + incentives',
    experience: '0–2 years',
    description: 'Modern trade & general trade coverage, beat planning.',
    pinned: false,
    postedAt: Date.now() - 26 * 3600_000,
    postedBy: 'admin',
  },
  {
    id: jid(),
    title: 'Customer Support — Part Time',
    company: 'ShopKart E-commerce',
    manager: 'Neha M.',
    contact: '+91-98XXX-55555',
    managerEmail: 'neha.m@shopkart.example',
    location: 'Work from home',
    category: 'Part-time',
    salary: '₹8,000 – 12,000 / month',
    experience: 'Fresher',
    description: '4 hours/day voice support; Hindi + English mandatory.',
    pinned: false,
    postedAt: Date.now() - 48 * 3600_000,
    postedBy: 'admin',
  },
  {
    id: jid(),
    title: 'Business Correspondent Executive',
    company: 'Prajan Bank',
    manager: 'Mohan K.',
    contact: '+91-98XXX-66666',
    location: 'Visakhapatnam, AP',
    category: 'Banking',
    salary: '₹2.0 – 3.0 LPA',
    experience: '0–2 years',
    description: 'Account opening, CSP operations, financial literacy drives.',
    pinned: false,
    postedAt: Date.now() - 72 * 3600_000,
    postedBy: 'admin',
  },
  {
    id: jid(),
    title: 'Junior Frontend Developer (React)',
    company: 'StackNest IT Solutions',
    manager: 'Karthik V.',
    contact: '+91-98XXX-77777',
    location: 'Hyderabad (Madhapur)',
    category: 'IT',
    salary: '₹3.5 – 6.0 LPA',
    experience: '0–2 years',
    description: 'React + TypeScript; build SaaS dashboards with senior mentorship.',
    pinned: false,
    postedAt: Date.now() - 96 * 3600_000,
    postedBy: 'admin',
  },
  {
    id: jid(),
    title: 'Insurance Advisor (LIC)',
    company: 'LifeSecure Insurance',
    manager: 'Divya S.',
    contact: '+91-98XXX-88888',
    location: 'Tirupati, AP',
    category: 'Insurance',
    salary: 'Commission based',
    experience: 'Fresher+',
    description: 'Flexible timing; training + license support provided.',
    pinned: false,
    postedAt: Date.now() - 120 * 3600_000,
    postedBy: 'admin',
  },
  {
    id: jid(),
    title: 'Staff Nurse',
    company: 'SaiMulti Speciality Hospital',
    manager: 'Matron Mary',
    contact: '+91-98XXX-99999',
    location: 'Guntur, AP',
    category: 'Healthcare',
    salary: '₹18k – 28k / month',
    experience: '1–4 years',
    description: 'GNM/B.Sc nursing; rotational shifts; in-patient ward duties.',
    pinned: false,
    postedAt: Date.now() - 150 * 3600_000,
    postedBy: 'admin',
  },
  {
    id: jid(),
    title: 'Finance Telecaller',
    company: 'QuickLoan Finance',
    manager: 'Arjun T.',
    contact: '+91-98XXX-10101',
    location: 'Vijayawada, AP',
    category: 'Finance',
    salary: '₹14k – 22k + incentives',
    experience: '0–2 years',
    description: 'Personal loan leads; day shift; Telugu + Hindi required.',
    pinned: false,
    postedAt: Date.now() - 200 * 3600_000,
    postedBy: 'admin',
  },
  {
    id: jid(),
    title: 'E-commerce Delivery Partner',
    company: 'ZippEx Logistics',
    manager: 'Local Hub',
    contact: '+91-98XXX-20202',
    location: 'Multiple cities',
    category: 'E-commerce',
    salary: '₹18k – 35k / month',
    experience: 'Fresher',
    description: 'Two-wheeler + DL mandatory; daily payout options.',
    pinned: false,
    postedAt: Date.now() - 250 * 3600_000,
    postedBy: 'admin',
  },
  {
    id: jid(),
    title: 'Field Officer — Microfinance',
    company: 'GramaSeva Microfin',
    manager: 'Ramana P.',
    contact: '+91-98XXX-30303',
    location: 'Nellore, AP',
    category: 'Field',
    salary: '₹2.1 – 3.0 LPA',
    experience: '0–2 years',
    description: 'JLG group meetings, collections, village travel.',
    pinned: false,
    postedAt: Date.now() - 300 * 3600_000,
    postedBy: 'admin',
  },
]

export function getJobs(): Job[] {
  const existing = read<Job[]>(JOBS_KEY, [])
  if (existing.length === 0) {
    write(JOBS_KEY, DEFAULT_JOBS)
    return DEFAULT_JOBS
  }
  return existing
}

export function saveJobs(jobs: Job[]) {
  write(JOBS_KEY, jobs)
}

export function addJob(j: Omit<Job, 'id' | 'postedAt'> & { id?: string; postedAt?: number }): Job {
  const jobs = getJobs()
  const job: Job = {
    id: j.id || jid(),
    postedAt: j.postedAt || Date.now(),
    title: j.title,
    company: j.company,
    manager: j.manager,
    contact: j.contact,
    managerEmail: j.managerEmail,
    location: j.location,
    category: j.category,
    salary: j.salary,
    experience: j.experience,
    description: j.description,
    pinned: !!j.pinned,
    postedBy: j.postedBy || 'admin',
  }
  jobs.unshift(job)
  saveJobs(jobs)
  broadcast({
    kind: 'job-posted',
    jobTitle: job.title,
    company: job.company,
    category: job.category,
    location: job.location,
    pinned: job.pinned,
  })
  return job
}

export function updateJob(id: string, patch: Partial<Job>) {
  const jobs = getJobs()
  const idx = jobs.findIndex((j) => j.id === id)
  if (idx === -1) return null
  jobs[idx] = { ...jobs[idx], ...patch }
  saveJobs(jobs)
  if (
    patch.title !== undefined ||
    patch.company !== undefined ||
    patch.salary !== undefined ||
    patch.location !== undefined ||
    patch.managerEmail !== undefined ||
    patch.contact !== undefined ||
    patch.pinned !== undefined
  ) {
    broadcast({ kind: 'job-edited', jobTitle: jobs[idx].title, company: jobs[idx].company })
  }
  return jobs[idx]
}

export function deleteJob(id: string) {
  const jobs = getJobs().filter((j) => j.id !== id)
  saveJobs(jobs)
}

export function togglePin(id: string, pinned: boolean) {
  return updateJob(id, { pinned })
}

export function sortedJobs(jobs: Job[]): Job[] {
  return [...jobs].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
    const pa = CATEGORY_PRIORITY[a.category] ?? 50
    const pb = CATEGORY_PRIORITY[b.category] ?? 50
    if (pa !== pb) return pa - pb
    return b.postedAt - a.postedAt
  })
}

export function filterJobs(
  jobs: Job[],
  opts: { query?: string; category?: JobCategory; location?: string },
): Job[] {
  const q = opts.query?.trim().toLowerCase()
  const loc = opts.location?.trim().toLowerCase()
  return jobs.filter((j) => {
    if (opts.category && opts.category !== 'All' && j.category !== opts.category) return false
    if (q) {
      const hay = `${j.title} ${j.company} ${j.category} ${j.description ?? ''}`.toLowerCase()
      if (!hay.includes(q)) return false
    }
    if (loc && !j.location.toLowerCase().includes(loc)) return false
    return true
  })
}

export function jobStats(jobs: Job[]) {
  const total = jobs.length
  const mr = jobs.filter((j) => j.category === 'MR').length
  const pinned = jobs.filter((j) => j.pinned).length
  const other = total - mr
  return { total, mr, pinned, other }
}
