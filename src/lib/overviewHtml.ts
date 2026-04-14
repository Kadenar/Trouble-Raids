// Fallback parser for raw Google Sheets HTML.
// Responsibilities:
// - turn the published table markup into structured cell data
// - extract text, links, spans, and lightweight style hints
// - filter out CMS rows
// - rebuild merged cell layout after filtering

import type { OverviewCell, OverviewSnapshot } from './types';

const CMS_EVENT_PATTERNS = [/wing\s*8\s*cms/i, /strike\s*cms/i, /wing\s*4\s*cms/i];

// Split a CSS style attribute into a key/value map.
function parseStyleDeclarations(styleText: string) {
  return styleText.split(';').reduce<Record<string, string>>((styles, part) => {
    const index = part.indexOf(':');
    if (index === -1) return styles;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (!key || !value) return styles;
    styles[key] = value;
    return styles;
  }, {});
}

// Normalize text so labels and event names can be matched reliably.
function normalizeText(value: string) {
  return value.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
}

// Collect Google-generated class CSS rules from the document's <style> tags.
function collectClassStyles(doc: Document) {
  const styleMap = new Map<string, Record<string, string>>();
  const styleTexts = Array.from(doc.querySelectorAll('style')).map((style) => style.textContent ?? '');
  const rulePattern = /\.s(\d+)\{([^}]*)\}/g;

  for (const styleText of styleTexts) {
    let match: RegExpExecArray | null;
    while ((match = rulePattern.exec(styleText))) {
      const className = `s${match[1]}`;
      const declarations = parseStyleDeclarations(match[2]);
      const existing = styleMap.get(className) ?? {};
      styleMap.set(className, { ...existing, ...declarations });
    }
  }

  return styleMap;
}

// Extract visible text from a cell while dropping script/style/SVG noise.
function getTextContent(cell: Element) {
  const clone = cell.cloneNode(true) as Element;
  clone.querySelectorAll('style, script, svg, canvas, noscript').forEach((node) => node.remove());
  const text = (clone.textContent ?? '')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .trimEnd();
  if (/^\.[A-Za-z0-9_-]+.*\{.*\}$/.test(text) || text.includes('.SSparkchart')) {
    return '';
  }
  return text;
}

// Count the widest row in the sheet so the snapshot can preserve its width.
function getColumnCount(table: HTMLTableElement) {
  const rows = Array.from(table.querySelectorAll('tr'));
  let max = 0;
  for (const row of rows) {
    let count = 0;
    for (const cell of Array.from(row.children)) {
      if (cell.tagName !== 'TD' && cell.tagName !== 'TH') continue;
      count += Number(cell.getAttribute('colspan') ?? '1') || 1;
    }
    max = Math.max(max, count);
  }
  return max;
}

// Parse numeric style values such as row height.
function parseNumber(value: string | null | undefined) {
  const next = Number(value);
  return Number.isFinite(next) ? next : null;
}

// Find the event column so CMS rows can be filtered consistently.
function findEventColumnIndex(rows: Array<Array<OverviewCell | null>>) {
  for (const row of rows.slice(0, 12)) {
    for (let cellIndex = 0; cellIndex < row.length; cellIndex += 1) {
      const cell = row[cellIndex];
      const text = normalizeText(cell?.text ?? '');
      if (text === 'events' || text === 'event') {
        return cellIndex;
      }
    }
  }
  return null;
}

function shouldExcludeCmsRow(row: Array<OverviewCell | null>, activeEventText = '') {
  const rowText = row.map((cell) => normalizeText(cell?.text ?? '')).join(' ').trim().toLowerCase();
  const label = `${normalizeText(activeEventText).toLowerCase()} ${rowText}`.trim();
  return CMS_EVENT_PATTERNS.some((pattern) => pattern.test(label));
}

function findCmsSectionLabel(row: Array<OverviewCell | null>) {
  const rowText = row.map((cell) => normalizeText(cell?.text ?? '')).join(' ').trim();
  return CMS_EVENT_PATTERNS.find((pattern) => pattern.test(rowText)) ? rowText : '';
}

// Rebuild the row matrix after filtering while preserving merged spans.
function rebuildFilteredRows(
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

// Parse raw Google Sheets HTML into the shared overview snapshot shape.
export function parseOverviewHtml(html: string): OverviewSnapshot {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  const table = doc.querySelector<HTMLTableElement>('table.waffle, table');
  if (!table) {
    throw new Error('No table found in HTML response.');
  }

  const title = doc.querySelector('title')?.textContent?.trim() || 'Overview';
  const tableRows = Array.from(table.querySelectorAll('tr'));
  const columnCount = getColumnCount(table);
  const classStyles = collectClassStyles(doc);
  const rows: Array<Array<OverviewCell | null>> = [];
  const rowHeights: Array<number | null> = [];
  const columnWidths: Array<number | null> = Array.from({ length: columnCount }, () => null);
  const occupied = new Map<string, number>();

  for (let rowIndex = 0; rowIndex < tableRows.length; rowIndex += 1) {
    const row = tableRows[rowIndex];
    const rowCells = Array.from({ length: columnCount }, () => null as OverviewCell | null);
    const rowHeight = parseNumber(row.getAttribute('style')?.match(/height:\s*([0-9.]+)px/i)?.[1] ?? null);
    rowHeights.push(rowHeight);

    let colIndex = 0;
    for (const child of Array.from(row.children)) {
      if (child.tagName !== 'TD' && child.tagName !== 'TH') continue;
      if (child.tagName === 'TH' && child.classList.contains('row-headers-background')) {
        continue;
      }
      if (child.classList.contains('freezebar-cell')) {
        continue;
      }

      while (occupied.get(`${rowIndex}:${colIndex}`)) {
        colIndex += 1;
      }

      const spanRow = Number(child.getAttribute('rowspan') ?? '1') || 1;
      const spanCol = Number(child.getAttribute('colspan') ?? '1') || 1;
      const anchor = child.querySelector<HTMLAnchorElement>('a');
      const classes = (child.getAttribute('class') ?? '')
        .split(/\s+/)
        .map((className) => className.trim())
        .filter(Boolean);
      const classStyle = classes.reduce<Record<string, string>>((acc, className) => {
        const next = classStyles.get(className);
        return next ? { ...acc, ...next } : acc;
      }, {});
      const inlineStyle = parseStyleDeclarations(child.getAttribute('style') ?? '');
      const mergedStyle = { ...classStyle, ...inlineStyle };
      const cellStyle: Record<string, string> = {};
      if (mergedStyle['background-color']) {
        cellStyle['background-color'] = mergedStyle['background-color'].trim();
      }
      if (mergedStyle.color) {
        cellStyle.color = mergedStyle.color.trim();
      }
      if (mergedStyle['white-space']) {
        cellStyle['white-space'] = mergedStyle['white-space'].trim();
      }
      if (mergedStyle['font-weight']) {
        cellStyle['font-weight'] = mergedStyle['font-weight'].trim();
      }
      if (mergedStyle['text-align']) {
        cellStyle['text-align'] = mergedStyle['text-align'].trim();
      }
      if (mergedStyle['vertical-align']) {
        cellStyle['vertical-align'] = mergedStyle['vertical-align'].trim();
      }
      const cell: OverviewCell = {
        text: getTextContent(child),
        href: anchor?.href,
        rowSpan: spanRow > 1 ? spanRow : undefined,
        colSpan: spanCol > 1 ? spanCol : undefined,
        style: cellStyle,
        bold:
          /^bold$/i.test(cellStyle['font-weight'] ?? '') ||
          Number(cellStyle['font-weight']) >= 600 ||
          /^bold$/i.test(mergedStyle['font-weight'] ?? '') ||
          Number(mergedStyle['font-weight']) >= 600,
      };
      rowCells[colIndex] = cell;

      for (let r = 0; r < spanRow; r += 1) {
        for (let c = 0; c < spanCol; c += 1) {
          if (r === 0 && c === 0) continue;
          occupied.set(`${rowIndex + r}:${colIndex + c}`, 1);
        }
      }

      colIndex += spanCol;
    }

    rows.push(rowCells);
  }

  const eventColumnIndex = findEventColumnIndex(rows);
  let activeCmsSection = false;
  const keepRows = rows.map((row) => {
    const cmsSectionLabel = findCmsSectionLabel(row);
    if (cmsSectionLabel) {
      activeCmsSection = true;
      return false;
    }

    if (row.some((cell) => /^Wing\s*[1-8]\b/i.test(cell?.text ?? ''))) {
      activeCmsSection = false;
    }

    const eventText = normalizeText(eventColumnIndex !== null ? row[eventColumnIndex]?.text ?? '' : '');
    if (eventText) {
      activeCmsSection = false;
    }

    return !shouldExcludeCmsRow(row, activeCmsSection);
  });
  const filtered = rebuildFilteredRows(rows, rowHeights, keepRows, columnCount);

  while (filtered.rows.length && filtered.rows[filtered.rows.length - 1].every((cell) => !cell || !cell.text)) {
    filtered.rows.pop();
    filtered.rowHeights.pop();
  }

  return {
    title,
    fetchedAt: Date.now(),
    rows: filtered.rows,
    rowHeights: filtered.rowHeights,
    columnWidths,
  };
}

// Fetch the raw HTML source for the published sheet.
export async function fetchOverviewHtml(url: string) {
  const response = await fetch(url, {
    cache: 'no-store',
    credentials: 'omit',
  });
  if (!response.ok) {
    throw new Error(`Overview HTML request failed: ${response.status}`);
  }
  return await response.text();
}
