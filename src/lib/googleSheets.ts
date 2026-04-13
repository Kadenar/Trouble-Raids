// Local cache helpers for the overview page.
// Responsibilities:
// - define the cached overview snapshot shape
// - persist the snapshot in localStorage
// - read and clear the cached snapshot
// - no network fetching or Google API logic lives here anymore

export const OVERVIEW_CACHE_KEY = 'trouble.overviewSheet.v2';

export type OverviewSheetCell = {
  text: string;
  href?: string;
  rowSpan?: number;
  colSpan?: number;
  bold?: boolean;
  style?: Record<string, string>;
};

export type OverviewSheetSnapshot = {
  spreadsheetId: string;
  sheetTitle: string;
  fetchedAt: number;
  rowHeights: Array<number | null>;
  columnWidths: Array<number | null>;
  rows: Array<Array<OverviewSheetCell | null>>;
};

// Read the cached overview snapshot from localStorage.
export function readOverviewCache() {
  try {
    const raw = window.localStorage.getItem(OVERVIEW_CACHE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as OverviewSheetSnapshot;
  } catch {
    return null;
  }
}

// Persist the overview snapshot to localStorage.
export function writeOverviewCache(snapshot: OverviewSheetSnapshot) {
  window.localStorage.setItem(OVERVIEW_CACHE_KEY, JSON.stringify(snapshot));
}

// Remove the cached overview snapshot from localStorage.
export function clearOverviewCache() {
  window.localStorage.removeItem(OVERVIEW_CACHE_KEY);
}
