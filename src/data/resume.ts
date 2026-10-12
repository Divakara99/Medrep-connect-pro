import { read, remove, write } from './storage'

/**
 * The applicant's resume/CV. Stored on this device and sent along with every
 * job application: the file name and a one-tap download are included in the
 * application flow (mail/WhatsApp cannot pre-attach files, so the resume is
 * attached in one tap right after the composer opens).
 */
export type ResumeRecord = {
  fileName: string
  mimeType: string
  size: number
  dataUrl: string // data: URL so the resume can be downloaded/attached instantly
  updatedAt: number
}

const MAX_RESUME_BYTES = 1_500_000 // keep well inside localStorage quota

function resumeKey(email: string): string {
  return `mrc_resume_v1::${email.trim().toLowerCase()}`
}

export function getResume(email: string): ResumeRecord | null {
  const saved = read<ResumeRecord | null>(resumeKey(email), null)
  if (!saved || typeof saved.dataUrl !== 'string' || typeof saved.fileName !== 'string') return null
  return saved
}

export async function saveResume(email: string, file: File): Promise<{ ok: true; resume: ResumeRecord } | { ok: false; error: string }> {
  if (file.size > MAX_RESUME_BYTES) {
    return { ok: false, error: 'Resume is too large. Please upload a file under 1.5 MB.' }
  }
  const allowed = /\.(pdf|doc|docx)$/i.test(file.name)
  if (!allowed) {
    return { ok: false, error: 'Upload the resume as PDF, DOC or DOCX.' }
  }
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('Could not read the resume file.'))
    reader.readAsDataURL(file)
  })
  const resume: ResumeRecord = {
    fileName: file.name,
    mimeType: file.type || 'application/octet-stream',
    size: file.size,
    dataUrl,
    updatedAt: Date.now(),
  }
  try {
    write(resumeKey(email), resume)
  } catch {
    return { ok: false, error: 'Could not store the resume on this device. Please try a smaller file.' }
  }
  return { ok: true, resume }
}

export function clearResume(email: string): void {
  remove(resumeKey(email))
}
