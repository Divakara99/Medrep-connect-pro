import { useEffect, useMemo, useRef, useState } from 'react'
import { Input } from './ui'

export type DropdownOption = { value: string; label: string }

type SearchableDropdownProps = {
  id: string
  value: string
  options: DropdownOption[]
  placeholder: string
  onChange: (value: string) => void
}

/** Search-as-you-type single select used for profile city and state. */
export function SearchableDropdown({ id, value, options, placeholder, onChange }: SearchableDropdownProps) {
  const root = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const selected = options.find((option) => option.value === value)
  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase()
    return needle ? options.filter((option) => option.label.toLocaleLowerCase().includes(needle)) : options
  }, [options, query])

  useEffect(() => {
    if (!open) return
    const closeOnOutside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) {
        setOpen(false)
        setQuery('')
      }
    }
    document.addEventListener('pointerdown', closeOnOutside)
    return () => document.removeEventListener('pointerdown', closeOnOutside)
  }, [open])

  return (
    <div ref={root} className="relative">
      <Input
        id={id}
        type="text"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={`${id}-options`}
        autoComplete="off"
        value={open ? query : selected?.label ?? ''}
        placeholder={placeholder}
        onFocus={() => { setQuery(''); setOpen(true) }}
        onChange={(event) => { setQuery(event.target.value); setOpen(true) }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') { setOpen(false); setQuery('') }
          if (event.key === 'ArrowDown' && !open) setOpen(true)
        }}
      />
      {open && (
        <div id={`${id}-options`} role="listbox" aria-label={placeholder} className="absolute z-30 mt-1 max-h-56 w-full overflow-y-auto rounded-xl border border-slate-200 bg-white p-1 shadow-xl">
          {filtered.length ? filtered.map((option) => (
            <button
              key={option.value}
              type="button"
              role="option"
              aria-selected={option.value === value}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => { onChange(option.value); setQuery(''); setOpen(false) }}
              className={`block w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-brand-50 ${option.value === value ? 'bg-brand-50 font-bold text-brand-800' : 'text-slate-800'}`}
            >
              {option.label}
            </button>
          )) : <div className="px-3 py-2 text-sm text-slate-500">No matches</div>}
        </div>
      )}
    </div>
  )
}

type MultiSelectDropdownProps = {
  id: string
  value: string[]
  options: string[]
  placeholder: string
  onChange: (value: string[]) => void
}

/** Searchable check-list with visible selected chips for profile languages/skills. */
export function MultiSelectDropdown({ id, value, options, placeholder, onChange }: MultiSelectDropdownProps) {
  const root = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const allOptions = useMemo(() => [...new Set([...options, ...value])], [options, value])
  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase()
    return needle ? allOptions.filter((option) => option.toLocaleLowerCase().includes(needle)) : allOptions
  }, [allOptions, query])

  useEffect(() => {
    if (!open) return
    const closeOnOutside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) {
        setOpen(false)
        setQuery('')
      }
    }
    document.addEventListener('pointerdown', closeOnOutside)
    return () => document.removeEventListener('pointerdown', closeOnOutside)
  }, [open])

  function toggle(option: string) {
    onChange(value.includes(option) ? value.filter((item) => item !== option) : [...value, option])
  }

  return (
    <div ref={root} className="relative">
      <button
        id={id}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={`${id}-options`}
        onClick={() => { setOpen((wasOpen) => !wasOpen); setQuery('') }}
        className="flex min-h-12 w-full items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-left text-sm font-medium text-slate-700 shadow-[inset_0_1px_2px_rgba(15,23,42,0.05)] focus:outline-none focus:ring-4 focus:ring-brand-500/15"
      >
        <span>{value.length ? `${value.length} selected` : placeholder}</span>
        <span aria-hidden="true" className="text-slate-500">{open ? '⌃' : '⌄'}</span>
      </button>
      {value.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {value.map((item) => (
            <span key={item} className="inline-flex items-center gap-1 rounded-full bg-brand-50 px-2.5 py-1 text-xs font-semibold text-brand-800 ring-1 ring-brand-200">
              {item}
              <button type="button" aria-label={`Remove ${item}`} onClick={() => toggle(item)} className="rounded-full px-0.5 text-brand-700 hover:bg-brand-100">×</button>
            </span>
          ))}
        </div>
      )}
      {open && (
        <div className="absolute z-30 mt-1 w-full rounded-xl border border-slate-200 bg-white p-2 shadow-xl">
          <Input
            type="search"
            aria-label={`Search ${placeholder.toLowerCase()}`}
            autoComplete="off"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={`Search ${placeholder.toLowerCase()}…`}
            className="mb-2 py-2 text-sm"
          />
          <div id={`${id}-options`} role="listbox" aria-multiselectable="true" aria-label={placeholder} className="max-h-52 overflow-y-auto">
            {filtered.length ? filtered.map((option) => {
              const selected = value.includes(option)
              return (
                <button
                  key={option}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => toggle(option)}
                  className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm text-slate-800 hover:bg-brand-50"
                >
                  <span aria-hidden="true" className={`grid h-5 w-5 shrink-0 place-items-center rounded border ${selected ? 'border-brand-600 bg-brand-600 text-white' : 'border-slate-300 bg-white'}`}>
                    {selected ? '✓' : ''}
                  </span>
                  {option}
                </button>
              )
            }) : <div className="px-2.5 py-2 text-sm text-slate-500">No matches</div>}
          </div>
          <button type="button" onClick={() => { setOpen(false); setQuery('') }} className="mt-2 w-full rounded-lg bg-slate-100 px-3 py-2 text-xs font-bold text-slate-700">Done</button>
        </div>
      )}
    </div>
  )
}
