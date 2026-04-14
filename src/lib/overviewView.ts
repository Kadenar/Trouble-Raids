// Shared view/model helpers for the overview feature.
// Responsibilities:
// - define shared types and constants used by both source loaders and the renderer
// - normalize text, colors, and alignment values
// - detect wing headers and divider columns
// - compute wing theming and sticky offsets
// - build CSS objects for rendered cells
// - filter/rebuild row matrices after CMS removal while preserving merged cells

import type { CSSProperties } from 'react';
import type { OverviewCell } from './types';

export type LoadSource = 'apps-script' | 'html-fallback';

export type WingTheme = {
  rowBg: string;
  gutterBg: string;
  text: string;
};

export type DividerPlacement = {
  columnIndex: number;
  startRowIndex: number;
  label: string;
};

export type MergedRange = {
  row: number;
  col: number;
  numRows: number;
  numCols: number;
};

export const DEFAULT_ROW_THEME: WingTheme = {
  rowBg: '#101722',
  gutterBg: '#0a101a',
  text: '#d6dfe8',
};

export const SUB_DIVIDER_LABELS = ['sub 2', 'sub2'];
export const CMS_EVENT_PATTERNS = [/wing\s*8\s*cms/i, /strike\s*cms/i, /wing\s*4\s*cms/i];

// Convert a zero-based column index to a spreadsheet letter label (A, B, … Z, AA, …).
export function getColumnLetter(columnIndex: number) {
  let index = columnIndex;
  let label = '';
  while (index >= 0) {
    label = String.fromCharCode(65 + (index % 26)) + label;
    index = Math.floor(index / 26) - 1;
  }
  return label;
}

// Collapse whitespace so sheet labels can be matched reliably.
export function normalizeText(value: string) {
  return value.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
}

// Find the wing number from the current row, if the row is a wing header.
export function detectWingIndex(row: Array<OverviewCell | null>) {
  for (const cell of row) {
    const text = normalizeText(cell?.text ?? '');
    const match = /^Wing\s*([1-8])\b/i.exec(text);
    if (match) {
      return Number(match[1]);
    }
  }
  return null;
}

// Convert a hex color string into RGB components for contrast calculations.
export function parseHexColor(value: string) {
  const match = /^#([0-9a-f]{6})$/i.exec(value.trim());
  if (!match) return null;
  const hex = match[1];
  return {
    r: Number.parseInt(hex.slice(0, 2), 16),
    g: Number.parseInt(hex.slice(2, 4), 16),
    b: Number.parseInt(hex.slice(4, 6), 16),
  };
}

// Pick readable text for a given wing background color.
export function contrastTextColor(backgroundColor: string) {
  const rgb = parseHexColor(backgroundColor);
  if (!rgb) return DEFAULT_ROW_THEME.text;
  const luminance = (0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b) / 255;
  return luminance > 0.58 ? '#111827' : '#f8fafc';
}

// Use the first wing row color as the theme for the whole wing block.
export function pickWingTheme(row: Array<OverviewCell | null>): WingTheme {
  for (const cell of row) {
    const backgroundColor = cell?.style?.['background-color']?.trim();
    if (!backgroundColor) continue;
    return {
      rowBg: backgroundColor,
      gutterBg: backgroundColor,
      text: contrastTextColor(backgroundColor),
    };
  }
  return DEFAULT_ROW_THEME;
}

// Locate the Sub 2 divider column so it can be visually separated.
export function findDividerPlacement(rows: Array<Array<OverviewCell | null>>, labelCandidates: string[]) {
  let columnIndex: number | null = null;
  let startRowIndex: number | null = null;
  let label = labelCandidates[0];

  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex];
    for (let cellIndex = 0; cellIndex < row.length; cellIndex += 1) {
      const text = normalizeText(row[cellIndex]?.text ?? '').toLowerCase();
      if (!text) continue;
      if (labelCandidates.some((candidate) => text === candidate || text.startsWith(`${candidate} `) || text.includes(` ${candidate} `))) {
        columnIndex = cellIndex;
        startRowIndex = rowIndex;
        label = row[cellIndex]?.text?.trim() ?? labelCandidates[0];
        break;
      }
    }
    if (columnIndex !== null && startRowIndex !== null) break;
  }

  if (columnIndex === null || startRowIndex === null) return null;
  return { columnIndex, startRowIndex, label } satisfies DividerPlacement;
}

// Find the event column so CMS rows can be filtered out consistently.
export function findEventColumnIndex(rows: Array<Array<OverviewCell | null>>) {
  for (const row of rows.slice(0, 12)) {
    for (let cellIndex = 0; cellIndex < row.length; cellIndex += 1) {
      const text = normalizeText(row[cellIndex]?.text ?? '');
      if (text === 'events' || text === 'event') {
        return cellIndex;
      }
    }
  }
  return null;
}

// Decide whether a row should be dropped because it belongs to a CMS section.
export function shouldExcludeCmsRow(row: Array<OverviewCell | null>, activeCmsSection = false) {
  if (activeCmsSection) return true;
  const rowText = row.map((cell) => normalizeText(cell?.text ?? '')).join(' ').trim().toLowerCase();
  return CMS_EVENT_PATTERNS.some((pattern) => pattern.test(rowText));
}

// Detect whether the current row explicitly starts a CMS section.
export function findCmsSectionLabel(row: Array<OverviewCell | null>) {
  const rowText = row.map((cell) => normalizeText(cell?.text ?? '')).join(' ').trim().toLowerCase();
  return CMS_EVENT_PATTERNS.some((pattern) => pattern.test(rowText)) ? rowText : '';
}

// Find columns whose header text should stay visible in every view mode.
export function findNamedColumnIndexes(rows: Array<Array<OverviewCell | null>>, labelCandidates: string[]) {
  const found = new Set<number>();
  for (const row of rows.slice(0, 10)) {
    for (let cellIndex = 0; cellIndex < row.length; cellIndex += 1) {
      const text = normalizeText(row[cellIndex]?.text ?? '').toLowerCase();
      if (!text) continue;
      if (labelCandidates.some((candidate) => text === candidate || text.startsWith(`${candidate} `) || text.includes(` ${candidate} `))) {
        found.add(cellIndex);
      }
    }
  }
  return Array.from(found).sort((a, b) => a - b);
}

// Rebuild the table after removing rows while keeping merged cells aligned.
export function rebuildFilteredRows(
  rows: Array<Array<OverviewCell | null>>,
  rowHeights: Array<number | null>,
  keepRows: boolean[],
  columnCount: number,
) {
  const keptRowIndexes = keepRows
    .map((keep, rowIndex) => (keep ? rowIndex : -1))
    .filter((rowIndex) => rowIndex >= 0);
  const newRowIndexMap = new Map<number, number>();
  keptRowIndexes.forEach((rowIndex, newRowIndex) => {
    newRowIndexMap.set(rowIndex, newRowIndex);
  });

  const rebuiltRows: Array<Array<OverviewCell | null>> = Array.from({ length: keptRowIndexes.length }, () =>
    Array.from({ length: columnCount }, () => null as OverviewCell | null),
  );
  const rebuiltRowHeights = keptRowIndexes.map((rowIndex) => rowHeights[rowIndex] ?? null);
  const occupied = new Map<string, number>();

  for (const oldRowIndex of keptRowIndexes) {
    const newRowIndex = newRowIndexMap.get(oldRowIndex);
    if (newRowIndex === undefined) continue;

    const sourceRow = rows[oldRowIndex] ?? [];
    for (let oldColIndex = 0; oldColIndex < sourceRow.length; oldColIndex += 1) {
      const cell = sourceRow[oldColIndex];
      if (!cell) continue;

      const originalRowSpan = cell.rowSpan ?? 1;
      const originalColSpan = cell.colSpan ?? 1;
      let adjustedRowSpan = 0;

      for (let rowIndex = oldRowIndex; rowIndex < oldRowIndex + originalRowSpan; rowIndex += 1) {
        if (keepRows[rowIndex]) {
          adjustedRowSpan += 1;
        }
      }

      if (adjustedRowSpan <= 0) continue;

      let newColIndex = oldColIndex;
      while (occupied.get(`${newRowIndex}:${newColIndex}`)) {
        newColIndex += 1;
      }

      const nextCell: OverviewCell = {
        text: cell.text,
        href: cell.href,
        rowSpan: adjustedRowSpan > 1 ? adjustedRowSpan : undefined,
        colSpan: originalColSpan > 1 ? originalColSpan : undefined,
        style: cell.style,
        bold: cell.bold,
      };

      rebuiltRows[newRowIndex][newColIndex] = nextCell;

      for (let rowOffset = 0; rowOffset < adjustedRowSpan; rowOffset += 1) {
        for (let colOffset = 0; colOffset < originalColSpan; colOffset += 1) {
          if (rowOffset === 0 && colOffset === 0) continue;
          occupied.set(`${newRowIndex + rowOffset}:${newColIndex + colOffset}`, 1);
        }
      }
    }
  }

  return { rows: rebuiltRows, rowHeights: rebuiltRowHeights };
}

// Build the base CSS for a cell before sticky positioning is applied.
export function cellStyle(cell: OverviewCell, columnWidth?: number | null, rowHeight?: number | null) {
  return {
    whiteSpace: cell.style?.['white-space'] || 'pre-wrap',
    fontWeight: cell.style?.['font-weight'] || (cell.bold ? '700' : undefined),
    textAlign: normalizeTextAlign(cell.style?.['text-align']),
    verticalAlign: normalizeVerticalAlign(cell.style?.['vertical-align']),
    width: columnWidth ? `${columnWidth}px` : undefined,
    minWidth: columnWidth ? `${columnWidth}px` : undefined,
    maxWidth: columnWidth ? `${columnWidth}px` : undefined,
    height: rowHeight ? `${rowHeight}px` : undefined,
  } satisfies CSSProperties;
}

// Convert arbitrary alignment text into a valid CSS textAlign value.
export function normalizeTextAlign(value: unknown): CSSProperties['textAlign'] | undefined {
  const next = normalizeAlignment(value);
  return next === 'left' || next === 'center' || next === 'right' ? next : undefined;
}

// Convert arbitrary alignment text into a valid CSS verticalAlign value.
export function normalizeVerticalAlign(value: unknown): CSSProperties['verticalAlign'] | undefined {
  const next = normalizeAlignment(value);
  return next === 'top' || next === 'middle' || next === 'bottom' ? next : undefined;
}

// Allow special instruction cells to spill across empty neighbors like Sheets.
export function shouldAllowTextOverflow(cell: OverviewCell) {
  const text = normalizeText(cell.text).toLowerCase();
  return /sub\s*1\s*left/i.test(text) || /sub\s*2\s*right/i.test(text) || /-\s*-\s*-\s*sub\s*1/i.test(text) || /-\s*-\s*-\s*sub\s*2/i.test(text);
}

// Stack the top three sheet rows so they stay pinned while scrolling.
export function getStickyRowTop(rowIndex: number, rowHeights: Array<number | null>) {
  if (rowIndex < 0 || rowIndex > 2) return undefined;
  const fallbackHeight = 24;
  let top = 0;
  for (let index = 0; index < rowIndex; index += 1) {
    top += rowHeights[index] ?? fallbackHeight;
  }
  return top;
}

// Normalize a raw alignment value from either Apps Script or HTML scrape.
export function normalizeAlignment(value: unknown) {
  if (typeof value !== 'string') return '';
  const next = value.trim().toLowerCase();
  if (next === 'left' || next === 'center' || next === 'right' || next === 'top' || next === 'middle' || next === 'bottom') {
    return next;
  }
  return '';
}

// Keep only non-empty color strings from the source payload.
export function normalizeColorString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}
