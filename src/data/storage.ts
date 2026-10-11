// Safe localStorage helpers.
export function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return fallback
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

export function write<T>(key: string, value: T): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* ignore quota */
  }
}

export function remove(key: string): void {
  try {
    localStorage.removeItem(key)
  } catch {
    /* ignore */
  }
}
