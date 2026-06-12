// Commissioning form cache + auto-match heuristic.
// Caches the forms index in localStorage (small — ~5 KB) and individual
// form schemas in-memory with optional localStorage backup. Falls back to
// the offline cache when the network is unavailable so inspectors at a
// remote site can still open a form they've previously downloaded.

import {
  fetchCommissioningIndex,
  fetchCommissioningForm,
  type CommissioningFormIndex,
  type CommissioningFormIndexEntry,
  type CommissioningFormSchema
} from './commissioningApi'

const INDEX_KEY = 'prism_commissioning_index_v1'
const FORM_KEY_PREFIX = 'prism_commissioning_form_v1:'
const INDEX_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000 // 7 days

interface CachedIndex {
  savedAt: number
  payload: CommissioningFormIndex
}

function readCachedIndex(): CommissioningFormIndex | null {
  try {
    const raw = localStorage.getItem(INDEX_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as CachedIndex
    if (!parsed?.payload?.forms) return null
    return parsed.payload
  } catch {
    return null
  }
}

function writeCachedIndex(payload: CommissioningFormIndex): void {
  try {
    localStorage.setItem(INDEX_KEY, JSON.stringify({ savedAt: Date.now(), payload } satisfies CachedIndex))
  } catch (e) {
    console.warn('[commissioningForms] Failed to persist index:', e)
  }
}

function isIndexStale(): boolean {
  try {
    const raw = localStorage.getItem(INDEX_KEY)
    if (!raw) return true
    const parsed = JSON.parse(raw) as CachedIndex
    return !parsed?.savedAt || (Date.now() - parsed.savedAt) > INDEX_MAX_AGE_MS
  } catch {
    return true
  }
}

export function slugFromFile(file: string): string {
  return file.replace(/\.json$/i, '')
}

export async function getCommissioningIndex(opts: { forceRefresh?: boolean } = {}): Promise<CommissioningFormIndex> {
  if (!opts.forceRefresh) {
    const cached = readCachedIndex()
    if (cached && !isIndexStale()) return cached
  }

  try {
    const fresh = await fetchCommissioningIndex()
    writeCachedIndex(fresh)
    return fresh
  } catch (err) {
    const cached = readCachedIndex()
    if (cached) {
      console.warn('[commissioningForms] Network fetch failed, using cached index:', err)
      return cached
    }
    throw err
  }
}

export async function getCommissioningForm(slug: string): Promise<CommissioningFormSchema> {
  const storageKey = FORM_KEY_PREFIX + slug

  try {
    const schema = await fetchCommissioningForm(slug)
    try { localStorage.setItem(storageKey, JSON.stringify(schema)) } catch { /* quota */ }
    return schema
  } catch (err) {
    try {
      const raw = localStorage.getItem(storageKey)
      if (raw) {
        console.warn(`[commissioningForms] Using cached schema for ${slug}:`, err)
        return JSON.parse(raw) as CommissioningFormSchema
      }
    } catch { /* ignore parse */ }
    throw err
  }
}

// Auto-match: turn a vehicle (unit_model / description) into a form slug.
// The heuristic tokenizes the vehicle labels and counts matches against the
// equipment label in the index. Ties are broken by longer equipment label,
// which favours more specific forms (e.g. "DUMP TRUCK" over "TRUCK").
export function autoMatchForm(
  vehicle: { unit_model?: string | null; manufacturer?: string | null; description?: string | null } | null | undefined,
  index: CommissioningFormIndex
): CommissioningFormIndexEntry | null {
  if (!vehicle) return null
  const haystackRaw = [vehicle.unit_model, vehicle.description, vehicle.manufacturer]
    .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
    .join(' ')
    .toUpperCase()
  if (!haystackRaw) return null
  const haystackTokens = new Set(haystackRaw.split(/[^A-Z0-9]+/).filter(t => t.length >= 3))
  if (haystackTokens.size === 0) return null

  let best: { entry: CommissioningFormIndexEntry; score: number; specificity: number } | null = null

  for (const entry of index.forms) {
    const equip = (entry.equipment || '').toUpperCase()
    if (!equip) continue
    const tokens = equip.split(/[^A-Z0-9]+/).filter(t => t.length >= 3)
    if (tokens.length === 0) continue

    let score = 0
    for (const token of tokens) {
      if (haystackTokens.has(token)) score += 2
      else if (haystackRaw.includes(token)) score += 1
    }
    // boost if ALL equipment tokens appear in the vehicle text
    const allMatch = tokens.every(t => haystackTokens.has(t) || haystackRaw.includes(t))
    if (allMatch) score += 3

    if (score <= 0) continue
    const specificity = equip.length
    if (!best || score > best.score || (score === best.score && specificity > best.specificity)) {
      best = { entry, score, specificity }
    }
  }

  return best?.entry ?? null
}

export function searchForms(
  index: CommissioningFormIndex,
  query: string
): CommissioningFormIndexEntry[] {
  const q = query.trim().toUpperCase()
  if (!q) return index.forms
  return index.forms.filter(f =>
    (f.equipment || '').toUpperCase().includes(q) ||
    (f.form_code || '').toUpperCase().includes(q)
  )
}
