// Local cache helpers for the overview page.
// Responsibilities:
// - define the cached overview snapshot shape
// - persist the snapshot in localStorage
// - read and clear the cached snapshot
// - no network fetching or Google API logic lives here anymore

export const OVERVIEW_CACHE_KEY = 'trouble.overviewSheet.v2';

// Read the cached overview snapshot from localStorage.
// Returns `unknown` — callers are responsible for narrowing or casting to their expected shape.
export function readOverviewCache(): unknown {
  try {
    const raw = window.localStorage.getItem(OVERVIEW_CACHE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

// Persist any serializable payload to localStorage.
// Accepts unknown because the cache layer only serializes — it does not depend on the shape.
export function writeOverviewCache(payload: unknown) {
  window.localStorage.setItem(OVERVIEW_CACHE_KEY, JSON.stringify(payload));
}

// Remove the cached overview snapshot from localStorage.
export function clearOverviewCache() {
  window.localStorage.removeItem(OVERVIEW_CACHE_KEY);
}
