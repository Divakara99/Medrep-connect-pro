#!/usr/bin/env node
/**
 * Copy the Supabase SQL migrations to the clipboard, in the order DEPLOY.md
 * requires, so each one can be pasted into the SQL Editor with one action.
 *
 *   npm run db:list              show the numbered migration list
 *   npm run db:copy -- 1         copy migration 1 (supabase/schema.sql)
 *   npm run db:copy -- all       copy every migration, in order, as one script
 *
 * If no clipboard tool is found, the SQL is printed instead so you can select
 * and copy it from the terminal. Nothing is written to the repository.
 */
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const MIGRATIONS = [
  { file: 'supabase/schema.sql', what: 'Auth-backed accounts and admin-only mirror RLS' },
  { file: 'supabase/payments.sql', what: 'Payment ledger and verified activation functions' },
  { file: 'supabase/secure_jobs.sql', what: 'Job projection: public and subscriber-only fields, description guard' },
  { file: 'supabase/user_notifications.sql', what: 'Durable broadcast job notifications' },
  { file: 'supabase/admin_access.sql', what: 'Manual grant method and audited grant_manual_access' },
  { file: 'supabase/admin_mfa.sql', what: 'Requires an authenticator (aal2) for admin access' },
  { file: 'supabase/billing_plans.sql', what: 'Server-side plan catalog and admin-only pricing' },
  { file: 'supabase/resumes.sql', what: 'Private resume bucket, owner-only access, 30-day retention' },
  { file: 'supabase/applications.sql', what: 'Server-side application history' },
  { file: 'supabase/support_requests.sql', what: 'Server-side refund and support requests; admin-only updates' },
  { file: 'supabase/vacancy_team.sql', what: 'Vacancy team logins: post and delete only, audit log of every add and delete' },
  { file: 'supabase/push_subscriptions.sql', what: 'Phone notifications: one row per device, own-device control, admin-only delivery stats' },
]

const root = fileURLToPath(new URL('..', import.meta.url))
const [command = 'help', target] = process.argv.slice(2)

function list() {
  console.log('Run these in order in Supabase → SQL Editor (same project as VITE_SUPABASE_URL):\n')
  MIGRATIONS.forEach((item, index) => {
    console.log(`  ${String(index + 1).padStart(2)}. ${item.file.padEnd(34)} ${item.what}`)
  })
  console.log('\nCopy one:   npm run db:copy -- <number>')
  console.log('Copy all:   npm run db:copy -- all')
}

function readMigration(item) {
  return readFileSync(join(root, item.file), 'utf8')
}

function buildSql(which) {
  if (which === 'all') {
    return MIGRATIONS.map((item, index) =>
      `-- ==== ${index + 1}/${MIGRATIONS.length}: ${item.file} ====\n${readMigration(item).trimEnd()}\n`,
    ).join('\n')
  }
  const number = Number(which)
  if (!Number.isInteger(number) || number < 1 || number > MIGRATIONS.length) {
    throw new Error(`Choose a number from 1 to ${MIGRATIONS.length}, or "all". Run "npm run db:list" to see them.`)
  }
  return readMigration(MIGRATIONS[number - 1])
}

// First clipboard tool that is installed wins.
const CLIPBOARD_TOOLS = [
  { cmd: 'pbcopy', args: [] }, // macOS
  { cmd: 'clip', args: [] }, // Windows
  { cmd: 'wl-copy', args: [] }, // Linux (Wayland)
  { cmd: 'xclip', args: ['-selection', 'clipboard'] }, // Linux (X11)
  { cmd: 'xsel', args: ['--clipboard', '--input'] }, // Linux (X11)
]

function copyToClipboard(text) {
  for (const tool of CLIPBOARD_TOOLS) {
    const result = spawnSync(tool.cmd, tool.args, { input: text, encoding: 'utf8' })
    if (!result.error && result.status === 0) return tool.cmd
  }
  return null
}

function copy(which) {
  const sql = buildSql(which)
  const tool = copyToClipboard(sql)
  const label = which === 'all' ? 'all migrations (in order)' : MIGRATIONS[Number(which) - 1].file
  if (tool) {
    console.log(`Copied ${label} to the clipboard (${tool}). Paste it into Supabase → SQL Editor → Run.`)
  } else {
    console.log(`No clipboard tool was found, so here is ${label}. Select the text below and copy it.\n`)
    console.log('-----BEGIN SQL-----')
    process.stdout.write(sql)
    console.log('\n-----END SQL-----')
  }
}

try {
  if (command === 'list') list()
  else if (command === 'copy' && target) copy(target)
  else if (command === 'copy') throw new Error('Name a migration: npm run db:copy -- 1  (or "all")')
  else { list() }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
}
