const KEY = 'watching.v1';
const SYMBOL = /^[A-Z0-9]{2,20}$/;

/** `globalThis.localStorage`, or undefined under static rendering and in tests that don't install one. */
function storage(): Storage | undefined {
  const candidate = globalThis.localStorage;
  if (
    candidate == null ||
    typeof candidate.getItem !== 'function' ||
    typeof candidate.setItem !== 'function'
  ) {
    return undefined;
  }
  return candidate;
}

/** Never throws. A missing, corrupt, or non-array value gives []. */
export function readWatched(): string[] {
  const store = storage();
  if (!store) return [];
  let raw: string | null;
  try {
    raw = store.getItem(KEY);
  } catch {
    return [];
  }
  if (raw == null) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const item of parsed) {
    if (typeof item !== 'string') continue;
    const id = item.toUpperCase();
    if (!SYMBOL.test(id) || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

/** Throws when there is no storage or when setItem throws. */
export function writeWatched(ids: readonly string[]): void {
  const store = storage();
  if (!store) throw new Error('localStorage is unavailable');
  store.setItem(KEY, JSON.stringify(ids));
}
