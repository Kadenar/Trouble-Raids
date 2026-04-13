// Apps Script loader for the live overview sheet.
// Responsibilities:
// - fetch the web app response
// - normalize Apps Script JSON into the shared overview snapshot shape
// - preserve merges, widths, heights, alignment, and bold state
// - filter CMS rows in the same way as the HTML fallback
// - fall back to the HTML parser if the response is not JSON

import type { OverviewHtmlCell, OverviewHtmlSnapshot } from './overviewHtml';
import {
  findEventColumnIndex,
  findCmsSectionLabel,
  detectWingIndex,
  normalizeAlignment,
  normalizeColorString,
  normalizeText,
  rebuildFilteredRows,
  shouldExcludeCmsRow,
  type MergedRange,
} from './overviewView';

export type OverviewAppsScriptPayload = {
  title?: string;
  sheetTitle?: string;
  rows?: string[][] | Array<Array<string | null | undefined>>;
  values?: string[][] | Array<Array<string | null | undefined>>;
  backgroundColors?: string[][] | Array<Array<string | null | undefined>>;
  foregroundColors?: string[][] | Array<Array<string | null | undefined>>;
  rowHeights?: Array<number | null>;
  columnWidths?: Array<number | null>;
  mergedRanges?: Array<Partial<MergedRange>>;
  horizontalAlignments?: Array<Array<'left' | 'center' | 'right' | null | undefined>>;
  verticalAlignments?: Array<Array<'top' | 'middle' | 'bottom' | null | undefined>>;
  bold?: Array<Array<boolean | null | undefined>>;
};

// Convert the Apps Script JSON payload into the same cell model used by the HTML parser.
export function buildSnapshotFromJson(payload: OverviewAppsScriptPayload): OverviewHtmlSnapshot {
  const matrix = (payload.rows ?? payload.values ?? []).map((row) => row.map((cell) => String(cell ?? '')));
  const backgroundMatrix = (payload.backgroundColors ?? []).map((row) => row.map((cell) => String(cell ?? '')));
  const foregroundMatrix = (payload.foregroundColors ?? []).map((row) => row.map((cell) => String(cell ?? '')));
  const maxColumns = Math.max(
    matrix.reduce((max, row) => Math.max(max, row.length), 0),
    ...(payload.mergedRanges ?? []).map((range) => (range.col ?? 0) - 1 + (range.numCols ?? 1)),
    backgroundMatrix.reduce((max, row) => Math.max(max, row.length), 0),
    foregroundMatrix.reduce((max, row) => Math.max(max, row.length), 0),
  );
  const rows: Array<Array<OverviewHtmlCell>> = matrix.map((row, rowIndex) =>
    Array.from({ length: maxColumns }, (_, cellIndex) => {
      const text = row[cellIndex] ?? '';
      return {
        text,
        bold: Boolean(payload.bold?.[rowIndex]?.[cellIndex]),
        rowSpan: undefined,
        colSpan: undefined,
        style: {
          'background-color': normalizeColorString(backgroundMatrix[rowIndex]?.[cellIndex]),
          color: normalizeColorString(foregroundMatrix[rowIndex]?.[cellIndex]),
          'text-align': normalizeAlignment(payload.horizontalAlignments?.[rowIndex]?.[cellIndex]),
          'vertical-align': normalizeAlignment(payload.verticalAlignments?.[rowIndex]?.[cellIndex]),
          'font-weight': Boolean(payload.bold?.[rowIndex]?.[cellIndex]) ? '700' : '',
        },
      };
    }),
  );

  // Rebuild merged cells so the table preserves the source sheet layout.
  for (const range of payload.mergedRanges ?? []) {
    const row = Number(range.row ?? 0) - 1;
    const col = Number(range.col ?? 0) - 1;
    const numRows = Number(range.numRows ?? 1) || 1;
    const numCols = Number(range.numCols ?? 1) || 1;
    if (row < 0 || col < 0) continue;
    const anchor = rows[row]?.[col];
    if (!anchor) continue;
    anchor.rowSpan = numRows > 1 ? numRows : undefined;
    anchor.colSpan = numCols > 1 ? numCols : undefined;
  }

  const eventColumnIndex = findEventColumnIndex(rows);
  let activeCmsSection = false;
  const keepRows = rows.map((row) => {
    const cmsSectionLabel = findCmsSectionLabel(row);
    if (cmsSectionLabel) {
      activeCmsSection = true;
      return false;
    }

    if (detectWingIndex(row)) {
      activeCmsSection = false;
    }

    const eventText = normalizeText(eventColumnIndex !== null ? row[eventColumnIndex]?.text ?? '' : '');
    if (eventText) {
      activeCmsSection = false;
    }

    return !shouldExcludeCmsRow(row, activeCmsSection);
  });
  const filtered = rebuildFilteredRows(rows, payload.rowHeights ?? matrix.map(() => null), keepRows, maxColumns);

  return {
    title: payload.title ?? payload.sheetTitle ?? 'Overview',
    fetchedAt: Date.now(),
    rows: filtered.rows,
    rowHeights: filtered.rowHeights,
    columnWidths: payload.columnWidths ?? Array.from({ length: maxColumns }, () => null),
  };
}

// Fetch the overview from Apps Script and normalize the JSON response.
export async function loadOverviewSnapshot(url: string): Promise<{ snapshot: OverviewHtmlSnapshot; source: 'apps-script' }> {
  const response = await fetch(url, {
    cache: 'no-store',
    credentials: 'omit',
  });
  if (!response.ok) {
    throw new Error(`Overview request failed: ${response.status}`);
  }

  const contentType = response.headers.get('content-type') ?? '';
  const bodyText = await response.text();

  if (contentType.includes('application/json') || bodyText.trim().startsWith('{') || bodyText.trim().startsWith('[')) {
    const payload = JSON.parse(bodyText) as OverviewAppsScriptPayload;
    return { snapshot: buildSnapshotFromJson(payload), source: 'apps-script' as const };
  }

  const preview = bodyText.trim().slice(0, 200).replace(/\s+/g, ' ');
  throw new Error(`Apps Script did not return JSON. First response text: ${preview || '[empty]'}`);
}
