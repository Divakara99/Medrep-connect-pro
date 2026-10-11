import { read, write } from './storage'

export type TicketStatus = 'open' | 'in_progress' | 'resolved'

export type Ticket = {
  id: string
  userId?: string
  email?: string
  name?: string
  subject: string
  message: string
  source: 'ai' | 'manual'
  kind?: 'support' | 'refund'
  paymentId?: string
  status: TicketStatus
  reply?: string
  createdAt: number
  updatedAt?: number
}

const TICKETS_KEY = 'mrc_tickets_v1'

function tid() {
  return 't_' + Math.random().toString(36).slice(2, 9)
}

export function getTickets(): Ticket[] {
  return read<Ticket[]>(TICKETS_KEY, [])
}

export function createTicket(t: Omit<Ticket, 'id' | 'createdAt' | 'status'> & { status?: TicketStatus }): Ticket {
  const list = getTickets()
  const ticket: Ticket = {
    id: tid(),
    userId: t.userId,
    email: t.email,
    name: t.name,
    subject: t.subject,
    message: t.message,
    source: t.source,
    kind: t.kind ?? 'support',
    paymentId: t.paymentId,
    status: t.status || 'open',
    createdAt: Date.now(),
  }
  list.unshift(ticket)
  write(TICKETS_KEY, list)
  return ticket
}

export function updateTicket(id: string, patch: Partial<Ticket>): Ticket | null {
  const list = getTickets()
  const idx = list.findIndex((t) => t.id === id)
  if (idx === -1) return null
  list[idx] = { ...list[idx], ...patch, updatedAt: Date.now() }
  write(TICKETS_KEY, list)
  return list[idx]
}
