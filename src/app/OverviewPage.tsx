import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { clearOverviewCache, readOverviewCache, writeOverviewCache } from '../lib/googleSheets';
import { type OverviewHtmlCell, type OverviewHtmlSnapshot } from '../lib/overviewHtml';
import { loadOverviewSnapshot } from '../lib/overviewAppsScript';
import {
  DEFAULT_ROW_THEME,
  SUB_DIVIDER_LABELS,
  cellStyle,
  detectWingIndex,
  findDividerPlacement,
  findNamedColumnIndexes,
  getStickyRowTop,
  pickWingTheme,
  normalizeText,
  shouldAllowTextOverflow,
  type LoadSource,
  type MergedRange,
} from '../lib/overviewView';

const OVERVIEW_SOURCE_URL =
  import.meta.env.VITE_OVERVIEW_SOURCE_URL ??
  'https://script.google.com/macros/s/AKfycbxMPqyWkHLx1R5_zKxfJwkluvGtRqOJ6MY-igYbUPhq3FDM1cbXcs9VRL31h6z7f4Vtbg/exec';
type LoadState = 'idle' | 'loading' | 'ready' | 'error';
type CachedOverviewSnapshot = OverviewHtmlSnapshot & { source?: LoadSource };
type CachedOverviewSnapshotWithPlayers = CachedOverviewSnapshot & { playerViewGroups?: PlayerViewGroups };
type ViewMode = 'all' | 'sub1' | 'sub2' | `player:${number}`;

type ProjectedTable = {
  rows: Array<Array<OverviewHtmlCell | null>>;
  columnWidths: Array<number | null>;
  columnIndexes: number[];
};

type PlayerViewOption = {
  columnIndex: number;
  label: string;
};

type PlayerViewGroups = {
  sub1: PlayerViewOption[];
  sub2: PlayerViewOption[];
};

/**
 * Convert a cached local-storage payload back into the runtime snapshot shape.
 * Returns `null` when the payload does not contain usable row data.
 */
function cacheToSnapshot(cache: unknown | null): OverviewHtmlSnapshot | null {
  const data = cache as {
    sheetTitle?: string;
    fetchedAt?: number;
    rows?: Array<Array<Record<string, any> | null>>;
    rowHeights?: Array<number | null>;
    columnWidths?: Array<number | null>;
    mergedRanges?: Array<MergedRange>;
  } | null;

  if (!data?.rows) return null;

  // Rebuild the nested cell objects and normalize the shape the page expects.
  // The cache stores a looser payload than the runtime snapshot model.
  return {
    title: data.sheetTitle ?? 'Overview',
    fetchedAt: data.fetchedAt ?? Date.now(),
    rows: (data.rows ?? []).map((row) =>
      row.map((cell) =>
        cell
          ? {
              // Force every field into the exact runtime type the table renderer uses.
              text: String(cell.text ?? ''),
              href: typeof cell.href === 'string' ? cell.href : undefined,
              rowSpan: typeof cell.rowSpan === 'number' ? cell.rowSpan : undefined,
              colSpan: typeof cell.colSpan === 'number' ? cell.colSpan : undefined,
              bold: Boolean(cell.bold),
              style: {
                // Keep the style object normalized so the renderer never has to guess.
                'background-color':
                  typeof cell.style?.['background-color'] === 'string'
                    ? cell.style['background-color']
                    : '',
                color:
                  typeof cell.style?.color === 'string'
                    ? cell.style.color
                    : '',
                'font-family':
                  typeof cell.style?.['font-family'] === 'string'
                    ? cell.style['font-family']
                    : typeof cell.fontFamily === 'string'
                      ? cell.fontFamily
                      : '',
                'font-size':
                  typeof cell.style?.['font-size'] === 'string'
                    ? cell.style['font-size']
                    : typeof cell.fontSize === 'number'
                      ? `${cell.fontSize}px`
                      : '',
                'font-weight':
                  typeof cell.style?.['font-weight'] === 'string'
                    ? cell.style['font-weight']
                    : cell.bold
                      ? '700'
                      : '400',
                'font-style':
                  typeof cell.style?.['font-style'] === 'string'
                    ? cell.style['font-style']
                    : cell.italic
                      ? 'italic'
                      : 'normal',
                'text-decoration':
                  typeof cell.style?.['text-decoration'] === 'string'
                    ? cell.style['text-decoration']
                    : cell.underline || cell.strikethrough
                      ? 'underline'
                      : '',
                'white-space':
                  typeof cell.style?.['white-space'] === 'string'
                    ? cell.style['white-space']
                    : typeof cell.whiteSpace === 'string'
                      ? cell.whiteSpace
                      : 'pre-wrap',
                'text-align':
                  typeof cell.style?.['text-align'] === 'string'
                    ? cell.style['text-align']
                    : typeof cell.horizontalAlignment === 'string'
                      ? cell.horizontalAlignment
                      : 'left',
                'vertical-align':
                  typeof cell.style?.['vertical-align'] === 'string'
                    ? cell.style['vertical-align']
                    : typeof cell.verticalAlignment === 'string'
                      ? cell.verticalAlignment
                      : 'middle',
              },
            }
          : null,
      ),
    ),
    rowHeights: data.rowHeights ?? [],
    columnWidths: data.columnWidths ?? [],
    mergedRanges: data.mergedRanges,
  };
}

/**
 * Convert the live snapshot into the lightweight cache payload stored on disk.
 * This keeps refreshes from starting with an empty view after reloads.
 */
function snapshotToCache(snapshot: OverviewHtmlSnapshot) {
  return {
    spreadsheetId: 'html',
    sheetTitle: snapshot.title,
    fetchedAt: snapshot.fetchedAt,
    source: 'apps-script' as LoadSource,
    rowHeights: snapshot.rowHeights,
    columnWidths: snapshot.columnWidths,
    // Store a compact copy of the row data so reloads can restore the last view.
    rows: snapshot.rows.map((row) =>
      row.map((cell) =>
        cell
          ? {
              // Strip the snapshot back down to a serializable payload.
              ...cell,
              bold: Boolean(cell.bold),
              style: {
                // Normalize only the style keys this page needs on restore.
                ...cell.style,
                'background-color': cell.style?.['background-color'] || '',
                color: cell.style?.color || '',
                'font-weight': cell.style?.['font-weight'] || (cell.bold ? '700' : ''),
              },
            }
          : cell,
      ),
    ),
  };
}

/**
 * Project the source grid down to the currently visible columns while preserving
 * merged-cell spans and keeping the projected column indexes aligned with widths.
 */
function projectColumns(
  rows: Array<Array<OverviewHtmlCell | null>>,
  columnWidths: Array<number | null>,
  columnIndexes: number[],
): ProjectedTable {
  const indexMap = new Map<number, number>();

  // Map source column indexes to projected positions for quick lookup.
  columnIndexes.forEach((columnIndex, visibleIndex) => {
    indexMap.set(columnIndex, visibleIndex);
  });

  // Allocate the projected grid up front so span handling can fill holes safely.
  const projectedRows: Array<Array<OverviewHtmlCell | null>> = Array.from({ length: rows.length }, () =>
    Array.from({ length: columnIndexes.length }, () => null as OverviewHtmlCell | null),
  );
  // Keep the visible widths aligned with the projected columns.
  const projectedWidths = columnIndexes.map((columnIndex) => columnWidths[columnIndex] ?? null);
  const occupied = new Map<string, number>();

  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    const sourceRow = rows[rowIndex] ?? [];
    for (let columnIndex = 0; columnIndex < sourceRow.length; columnIndex += 1) {
      const cell = sourceRow[columnIndex];
      if (!cell) continue;

      const rowSpan = cell.rowSpan ?? 1;
      const colSpan = cell.colSpan ?? 1;

      // Only keep the part of a merged cell that intersects the visible columns.
      const visibleColumnsInSpan = columnIndexes.filter((visibleColumnIndex) => {
        return visibleColumnIndex >= columnIndex && visibleColumnIndex < columnIndex + colSpan;
      });

      if (!visibleColumnsInSpan.length) continue;

      const visibleColumnIndex = indexMap.get(visibleColumnsInSpan[0]);
      if (visibleColumnIndex === undefined) continue;

      // Trim row spans that would run past the projected data.
      let adjustedRowSpan = 0;
      for (let spanRow = rowIndex; spanRow < rowIndex + rowSpan; spanRow += 1) {
        if (spanRow < rows.length) {
          adjustedRowSpan += 1;
        }
      }

      const nextCell: OverviewHtmlCell = {
        text: cell.text,
        href: cell.href,
        rowSpan: adjustedRowSpan > 1 ? adjustedRowSpan : undefined,
        colSpan: visibleColumnsInSpan.length > 1 ? visibleColumnsInSpan.length : undefined,
        style: cell.style,
        bold: cell.bold,
      };

      // Slide the cell right if the target slot is already consumed by a span.
      let targetColumn = visibleColumnIndex;
      while (occupied.get(`${rowIndex}:${targetColumn}`)) {
        targetColumn += 1;
      }

      if (targetColumn >= columnIndexes.length) continue;
      projectedRows[rowIndex][targetColumn] = nextCell;

      // Mark every covered slot so later cells do not overlap this merged region.
      for (let rowOffset = 0; rowOffset < adjustedRowSpan; rowOffset += 1) {
        for (let colOffset = 0; colOffset < visibleColumnsInSpan.length; colOffset += 1) {
          if (rowOffset === 0 && colOffset === 0) continue;
          occupied.set(`${rowIndex + rowOffset}:${targetColumn + colOffset}`, 1);
        }
      }
    }
  }

  return { rows: projectedRows, columnWidths: projectedWidths, columnIndexes };
}

// Pull the player labels from the most likely header row so the view selector stays in sync with the source.
function getPlayerViewGroups(
  rows: Array<Array<OverviewHtmlCell | null>>,
  dividerColumnIndex: number | null,
  alwaysVisibleColumns: number[],
): PlayerViewGroups {
  const alwaysVisible = new Set(alwaysVisibleColumns);
  const headerSearchRows = rows.slice(0, 8);

  for (const row of headerSearchRows) {
    const sub1Candidates: PlayerViewOption[] = [];
    const sub2Candidates: PlayerViewOption[] = [];

    for (let columnIndex = 0; columnIndex < row.length; columnIndex += 1) {
      if (alwaysVisible.has(columnIndex)) continue;

      const label = normalizeText(row[columnIndex]?.text ?? '');
      if (!label) continue;

      // Keep labels on the left of the divider in Sub 1 and labels on the right in Sub 2.
      if (dividerColumnIndex !== null && columnIndex < dividerColumnIndex && columnIndex > 0) {
        sub1Candidates.push({ columnIndex, label });
      } else if (dividerColumnIndex !== null && columnIndex >= dividerColumnIndex) {
        sub2Candidates.push({ columnIndex, label });
      }
    }

    // Prefer the first header row that contains exactly 10 player labels and nothing extra.
    if (sub1Candidates.length === 5 && sub2Candidates.length === 5) {
      return {
        sub1: sub1Candidates,
        sub2: sub2Candidates,
      };
    }
  }

  return { sub1: [], sub2: [] };
}

// Turn a zero-based column index into the spreadsheet letter label used for disambiguation.
function getColumnLetter(columnIndex: number) {
  let index = columnIndex;
  let label = '';

  while (index >= 0) {
    label = String.fromCharCode(65 + (index % 26)) + label;
    index = Math.floor(index / 26) - 1;
  }

  return label;
}

// Extract the selected player column from a `player:<index>` mode string.
function getPlayerColumnIndex(mode: ViewMode) {
  if (!mode.startsWith('player:')) return null;
  const parsed = Number(mode.slice('player:'.length));
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

/**
 * Resolve which source columns should remain visible for the current view mode.
 * This keeps the divider split and always-visible columns in the final column list.
 */
function getViewColumnIndexes(
  mode: ViewMode,
  columnCount: number,
  dividerColumnIndex: number | null,
  alwaysVisibleColumns: number[],
) {
  // "all" keeps every source column, and the sub views fall back if no divider exists.
  const base =
    mode === 'all' || dividerColumnIndex === null
      ? Array.from({ length: columnCount }, (_, index) => index)
      : mode === 'sub1'
        // Sub1 shows only the columns left of the divider.
        ? Array.from({ length: dividerColumnIndex }, (_, index) => index)
        // Sub2 keeps the first column plus everything on the right side of the divider.
        : mode.startsWith('player:')
          ? (() => {
              const playerColumnIndex = getPlayerColumnIndex(mode);
              return playerColumnIndex !== null
                ? [0, playerColumnIndex]
                : Array.from({ length: columnCount }, (_, index) => index);
            })()
          : [0, ...Array.from({ length: columnCount - dividerColumnIndex }, (_, index) => dividerColumnIndex + index)];

  // Merge the base view with any columns that must remain visible, then sort for rendering.
  return Array.from(new Set([...base, ...alwaysVisibleColumns])).sort((a, b) => a - b);
}

// Render the read-only overview page and keep it synced with the live source.
export default function OverviewPage() {
  const cachedOverview = readOverviewCache() as CachedOverviewSnapshotWithPlayers | null;
  const [snapshot, setSnapshot] = useState<OverviewHtmlSnapshot | null>(() => cacheToSnapshot(cachedOverview));
  const [loadState, setLoadState] = useState<LoadState>(() => (snapshot ? 'ready' : 'idle'));
  const [loadSource, setLoadSource] = useState<LoadSource | null>(() => cachedOverview?.source ?? null);
  const [hasLiveSnapshot, setHasLiveSnapshot] = useState(false);
  const [error, setError] = useState('');
  const [lastLoadedAt, setLastLoadedAt] = useState<number | null>(() => snapshot?.fetchedAt ?? null);
  const [viewMode, setViewMode] = useState<ViewMode>('all');
  const [viewMenuOpen, setViewMenuOpen] = useState(false);
  const viewMenuRef = useRef<HTMLDivElement | null>(null);

  const rows = snapshot?.rows ?? [];
  const columnWidths = snapshot?.columnWidths ?? [];
  const rowHeights = snapshot?.rowHeights ?? [];
  const columnCount = useMemo(() => rows.reduce((max, row) => Math.max(max, row.length), 0), [rows]);
  const divider = useMemo(() => findDividerPlacement(rows, SUB_DIVIDER_LABELS), [rows]);
  const persistentColumns = useMemo(() => findNamedColumnIndexes(rows, ['encounter', 'notes', 'event', 'events']), [rows]);
  const playerViewGroups = useMemo(
    () => getPlayerViewGroups(rows, divider?.columnIndex ?? null, persistentColumns),
    [rows, divider?.columnIndex, persistentColumns],
  );
  const cachedPlayerViewGroups = cachedOverview?.playerViewGroups ?? { sub1: [], sub2: [] };
  const effectivePlayerViewGroups =
    playerViewGroups.sub1.length > 0 || playerViewGroups.sub2.length > 0 ? playerViewGroups : cachedPlayerViewGroups;
  const showPlayerViews = hasLiveSnapshot && (effectivePlayerViewGroups.sub1.length > 0 || effectivePlayerViewGroups.sub2.length > 0);
  const viewColumnIndexes = useMemo(
    () => getViewColumnIndexes(viewMode, columnCount, divider?.columnIndex ?? null, persistentColumns),
    [viewMode, columnCount, divider?.columnIndex, persistentColumns],
  );
  const projected = useMemo(
    () => projectColumns(rows, columnWidths, viewColumnIndexes),
    [rows, columnWidths, viewColumnIndexes],
  );
  const tableMinWidth = Math.max(projected.columnIndexes.length, 1) * 120;
  const headerRowHeight = 36;
  const themedRows = useMemo(() => {
    // Carry the wing theme forward until the next wing header appears.
    let activeTheme = DEFAULT_ROW_THEME;
    return projected.rows.map((row) => {
      const wingIndex = detectWingIndex(row);
      if (wingIndex) {
        activeTheme = pickWingTheme(row);
      }
      return {
        row,
        theme: activeTheme,
      };
    });
  }, [projected.rows]);

  const selectedPlayer = useMemo(() => {
    const playerColumnIndex = getPlayerColumnIndex(viewMode);
    if (playerColumnIndex === null) return null;
    const allPlayers = [...effectivePlayerViewGroups.sub1, ...effectivePlayerViewGroups.sub2];
    return allPlayers.find((player) => player.columnIndex === playerColumnIndex) ?? null;
  }, [viewMode, effectivePlayerViewGroups]);
  const selectedViewLabel = useMemo(() => {
    if (viewMode === 'all') return 'All';
    if (viewMode === 'sub1') return 'Sub 1';
    if (viewMode === 'sub2') return 'Sub 2';
    if (selectedPlayer) {
      const side = effectivePlayerViewGroups.sub1.some((player) => player.columnIndex === selectedPlayer.columnIndex)
        ? 'Sub 1'
        : 'Sub 2';
      return `${side} / ${selectedPlayer.label}`;
    }
    return 'Player';
  }, [viewMode, selectedPlayer, effectivePlayerViewGroups]);

  useEffect(() => {
    if (!viewMenuOpen) return;

    const handlePointerDown = (event: MouseEvent) => {
      const root = viewMenuRef.current;
      if (!root || root.contains(event.target as Node)) return;
      setViewMenuOpen(false);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setViewMenuOpen(false);
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [viewMenuOpen]);

  // Refresh the sheet from the live source and update cache/state together.
  const loadHtml = async () => {
    setLoadState('loading');
    setError('');
    try {
      const { snapshot: nextSnapshot, source } = await loadOverviewSnapshot(OVERVIEW_SOURCE_URL);
      const nextDivider = findDividerPlacement(nextSnapshot.rows, SUB_DIVIDER_LABELS);
      const nextPersistentColumns = findNamedColumnIndexes(nextSnapshot.rows, ['encounter', 'notes', 'event', 'events']);
      const nextPlayerViewGroups = getPlayerViewGroups(
        nextSnapshot.rows,
        nextDivider?.columnIndex ?? null,
        nextPersistentColumns,
      );
      setSnapshot(nextSnapshot);
      setLoadSource(source);
      setLastLoadedAt(nextSnapshot.fetchedAt);
      setHasLiveSnapshot(true);
      setLoadState('ready');
      writeOverviewCache({ ...snapshotToCache(nextSnapshot), source, playerViewGroups: nextPlayerViewGroups } as never);
    } catch (loadError) {
      setLoadState('error');
      setError(loadError instanceof Error ? loadError.message : 'Could not load live Overview data.');
    }
  };

  useEffect(() => {
    void loadHtml();
  }, []);

  return (
    <div className="h-screen overflow-hidden bg-[radial-gradient(circle_at_top,_rgba(59,130,246,0.18),_transparent_28%),radial-gradient(circle_at_bottom_right,_rgba(34,197,94,0.12),_transparent_24%),linear-gradient(180deg,_#07101f_0%,_#0b1220_48%,_#050814_100%)] px-3 py-4 text-slate-100">
      <div className="flex h-full min-h-0 w-full max-w-[2200px] flex-col gap-2 md:flex-row md:gap-4">
        <aside className="rounded-2xl border border-slate-700/60 bg-slate-900/80 p-3 shadow-lg shadow-black/20 md:w-20 md:flex-none">
          <div className="flex h-full min-h-0 flex-col items-start gap-3 md:items-center">
            <div className="flex flex-wrap gap-2 text-[8px] font-semibold uppercase tracking-[0.12em] md:flex-col md:gap-2">
              <span className="rounded-full border border-slate-700 bg-slate-950/60 px-2.5 py-0.5 text-slate-300">
                {loadState === 'ready' ? 'Loaded' : loadState === 'loading' ? 'Loading' : 'Idle'}
              </span>
              <span className="rounded-full border border-slate-700 bg-slate-950/60 px-2.5 py-0.5 text-slate-300">
                {lastLoadedAt ? new Date(lastLoadedAt).toLocaleString() : 'Not loaded'}
              </span>
              <span className="rounded-full border border-slate-700 bg-slate-950/60 px-2.5 py-0.5 text-slate-300">
                {loadSource === 'apps-script' ? 'Apps Script' : loadSource === 'html-fallback' ? 'HTML fallback' : 'Source unknown'}
              </span>
            </div>
            {error ? <div className="text-sm text-rose-200">{error}</div> : null}
          </div>
        </aside>

        <section className="min-h-0 min-w-0 flex flex-1 flex-col rounded-2xl border border-slate-700/60 bg-slate-950/70 shadow-lg shadow-black/20">
          <div className="relative z-[300] flex flex-wrap items-center justify-between gap-2 px-4 pt-3 pb-2">
            <div className="text-[10px] font-semibold uppercase tracking-[0.36em] text-slate-400">Trouble Overview</div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="text-xs text-slate-400">Source: {OVERVIEW_SOURCE_URL}</div>
              <div ref={viewMenuRef} className="relative z-[300]">
                <span className="mr-2 text-[8px] font-semibold uppercase tracking-[0.16em] text-slate-500">View</span>
                <button
                  type="button"
                  onClick={() => setViewMenuOpen((open) => !open)}
                  className="inline-flex items-center gap-2 rounded-full border border-slate-700 bg-slate-950/60 px-3 py-1 text-[8px] font-semibold uppercase tracking-[0.12em] text-slate-200 outline-none transition hover:bg-slate-900"
                >
                  <span>{selectedViewLabel}</span>
                  <svg
                    aria-hidden="true"
                    viewBox="0 0 20 20"
                    fill="currentColor"
                    className={`h-3 w-3 text-slate-400 transition ${viewMenuOpen ? 'rotate-180' : ''}`}
                  >
                    <path
                      fillRule="evenodd"
                      d="M5.23 7.21a.75.75 0 0 1 1.06.02L10 10.94l3.71-3.71a.75.75 0 1 1 1.06 1.06l-4.24 4.25a.75.75 0 0 1-1.06 0L5.21 8.29a.75.75 0 0 1 .02-1.08Z"
                      clipRule="evenodd"
                    />
                  </svg>
                </button>
                {viewMenuOpen ? (
                  <div className="absolute right-0 top-[calc(100%+0.4rem)] z-[400] w-72 overflow-hidden rounded-2xl border border-slate-700/70 bg-slate-950/95 shadow-2xl shadow-black/40 backdrop-blur">
                    <div className="max-h-96 overflow-auto p-1">
                      <button
                        type="button"
                        onClick={() => {
                          setViewMode('all');
                          setViewMenuOpen(false);
                        }}
                        className={`flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-[0.16em] transition ${
                          viewMode === 'all' ? 'bg-cyan-400/15 text-cyan-100' : 'text-slate-200 hover:bg-slate-900'
                        }`}
                      >
                        <span>All</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          setViewMode('sub1');
                          setViewMenuOpen(false);
                        }}
                        className={`mt-1 flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-[0.16em] transition ${
                          viewMode === 'sub1' || (selectedPlayer && effectivePlayerViewGroups.sub1.some((player) => player.columnIndex === selectedPlayer.columnIndex))
                            ? 'bg-cyan-400/15 text-cyan-100'
                            : 'text-slate-200 hover:bg-slate-900'
                        }`}
                      >
                        <span>Sub 1</span>
                      </button>
                      {showPlayerViews && effectivePlayerViewGroups.sub1.length ? (
                        <div className="pl-3 pt-1">
                          <div className="mb-1 text-[9px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                            Players
                          </div>
                          <div className="space-y-1">
                            {effectivePlayerViewGroups.sub1.map((player) => {
                              const labelCounts = [
                                ...effectivePlayerViewGroups.sub1,
                                ...effectivePlayerViewGroups.sub2,
                              ].filter((option) => option.label === player.label).length;
                              const label =
                                labelCounts > 1 ? `${player.label} (${getColumnLetter(player.columnIndex)})` : player.label;
                              return (
                                <button
                                  key={`sub1-${player.columnIndex}`}
                                  type="button"
                                  onClick={() => {
                                    setViewMode(`player:${player.columnIndex}`);
                                    setViewMenuOpen(false);
                                  }}
                                  className={`flex w-full rounded-xl px-3 py-2 text-left text-[10px] font-medium transition ${
                                    viewMode === `player:${player.columnIndex}`
                                      ? 'bg-cyan-400/15 text-cyan-100'
                                      : 'text-slate-300 hover:bg-slate-900'
                                  }`}
                                >
                                  {label}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      ) : null}

                      <button
                        type="button"
                        onClick={() => {
                          setViewMode('sub2');
                          setViewMenuOpen(false);
                        }}
                        className={`mt-2 flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-[0.16em] transition ${
                          viewMode === 'sub2' || (selectedPlayer && effectivePlayerViewGroups.sub2.some((player) => player.columnIndex === selectedPlayer.columnIndex))
                            ? 'bg-cyan-400/15 text-cyan-100'
                            : 'text-slate-200 hover:bg-slate-900'
                        }`}
                      >
                        <span>Sub 2</span>
                      </button>
                      {showPlayerViews && effectivePlayerViewGroups.sub2.length ? (
                        <div className="pl-3 pt-1">
                          <div className="mb-1 text-[9px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                            Players
                          </div>
                          <div className="space-y-1">
                            {effectivePlayerViewGroups.sub2.map((player) => {
                              const labelCounts = [
                                ...effectivePlayerViewGroups.sub1,
                                ...effectivePlayerViewGroups.sub2,
                              ].filter((option) => option.label === player.label).length;
                              const label =
                                labelCounts > 1 ? `${player.label} (${getColumnLetter(player.columnIndex)})` : player.label;
                              return (
                                <button
                                  key={`sub2-${player.columnIndex}`}
                                  type="button"
                                  onClick={() => {
                                    setViewMode(`player:${player.columnIndex}`);
                                    setViewMenuOpen(false);
                                  }}
                                  className={`flex w-full rounded-xl px-3 py-2 text-left text-[10px] font-medium transition ${
                                    viewMode === `player:${player.columnIndex}`
                                      ? 'bg-cyan-400/15 text-cyan-100'
                                      : 'text-slate-300 hover:bg-slate-900'
                                  }`}
                                >
                                  {label}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      ) : null}
                    </div>
                  </div>
                ) : null}
              </div>
              <button
                type="button"
                onClick={() => void loadHtml()}
                disabled={loadState === 'loading'}
                className="rounded-full border border-cyan-300/30 bg-cyan-400/10 px-2.5 py-1 text-[8px] font-semibold uppercase tracking-[0.12em] text-cyan-100 transition hover:bg-cyan-400/20 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Refresh live
              </button>
              <button
                type="button"
                onClick={() => {
                  clearOverviewCache();
                  setSnapshot(null);
                  setLastLoadedAt(null);
                  setLoadSource(null);
                  setHasLiveSnapshot(false);
                  setViewMenuOpen(false);
                  setLoadState('idle');
                }}
                className="rounded-full border border-rose-300/30 bg-rose-400/10 px-2.5 py-1 text-[8px] font-semibold uppercase tracking-[0.12em] text-rose-100 transition hover:bg-rose-400/20"
              >
                Clear cache
              </button>
            </div>
          </div>
          <div className="overview-scrollbar min-h-0 min-w-0 flex-1 overflow-auto rounded-2xl pt-0">
            {loadState === 'loading' && !snapshot ? (
              <div className="flex min-h-full items-center justify-center px-4 py-12">
                <div className="rounded-2xl border border-slate-700/60 bg-slate-900/80 px-5 py-4 text-center shadow-lg shadow-black/20">
                  <div className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-400">Loading</div>
                  <div className="mt-2 text-sm text-slate-200">Fetching live Overview data...</div>
                </div>
              </div>
            ) : snapshot ? (
                <table
                  className="table-fixed border-separate border-spacing-0 text-[10px]"
                  style={{
                    minWidth: `${tableMinWidth}px`,
                    width: 'max-content',
                  }}
                >
                  <tbody>
                    <tr className="bg-slate-950 text-[9px] font-semibold uppercase tracking-[0.2em] text-slate-400">
                      <th
                        scope="col"
                        className="sticky left-0 top-0 z-[120] border-b border-r border-slate-700/60 bg-slate-950 px-2 py-2 text-center"
                        style={{
                          width: '48px',
                          minWidth: '48px',
                          maxWidth: '48px',
                          height: `${headerRowHeight}px`,
                          backgroundColor: '#0a101a',
                          color: '#d6dfe8',
                        }}
                      >
                        #
                      </th>
                      {projected.columnIndexes.map((index, projectedIndex) => {
                        const letter = String.fromCharCode(65 + index);
                        const width = projected.columnWidths[projectedIndex] ?? 120;
                        return (
                          <th
                            key={letter}
                            scope="col"
                        className="sticky top-0 z-40 border-b border-r border-slate-700/60 bg-slate-950 px-2 py-2 text-center"
                            style={{
                              width: `${width}px`,
                              minWidth: `${width}px`,
                              maxWidth: `${width}px`,
                              height: `${headerRowHeight}px`,
                            }}
                          >
                            {letter}
                          </th>
                        );
                      })}
                    </tr>
                    {themedRows.map(({ row, theme }, rowIndex) => (
                      (() => {
                        const stickyTop = getStickyRowTop(rowIndex, rowHeights);
                        const isStickyRow = stickyTop !== undefined;
                        return (
                        <tr
                        key={`${rowIndex}-${row.find((cell) => cell)?.text ?? 'row'}`}
                        style={{ backgroundColor: theme.rowBg, color: theme.text }}
                      >
                        <td
                          className="sticky left-0 z-20 border-b border-r border-slate-700/60 px-2 py-1 text-center"
                          style={{
                            width: '48px',
                            minWidth: '48px',
                            maxWidth: '48px',
                            height: rowHeights[rowIndex] ?? undefined,
                            backgroundColor: '#0a101a',
                            color: '#d6dfe8',
                            top: isStickyRow ? `${headerRowHeight + stickyTop}px` : undefined,
                            zIndex: rowIndex < 3 ? 90 : isStickyRow ? 80 : 60,
                          }}
                        >
                          {rowIndex + 1}
                        </td>
                        {row.map((cell, cellIndex) => {
                          if (!cell) return null;
                          const width = projected.columnWidths[cellIndex] ?? null;
                          const height = rowHeights[rowIndex] ?? null;
                          const isDivider = divider?.columnIndex === cellIndex && rowIndex >= (divider?.startRowIndex ?? 0);
                          const isStickyColumn = cellIndex === 0;
                          const baseCellStyle = cellStyle(cell, width, height);
                          const allowOverflow = shouldAllowTextOverflow(cell);
                          const sectionStyle = baseCellStyle;
                          const centeredOverflowText = allowOverflow && !cell.style?.['text-align'] ? 'center' : cell.style?.['text-align'];
                          const cellTextAlign = (centeredOverflowText || cell.style?.['text-align'] || undefined) as CSSProperties['textAlign'];
                          // Row 1 to 3 stay pinned to the top; column A and the row numbers stay frozen on the left.
                          const finalStyle: CSSProperties = {
                            ...sectionStyle,
                            backgroundColor: theme.rowBg,
                            position: isStickyRow || isStickyColumn ? 'sticky' : undefined,
                            left: isStickyColumn ? '48px' : undefined,
                            top: isStickyRow ? `${headerRowHeight + stickyTop}px` : undefined,
                            zIndex:
                              rowIndex < 3 && isStickyColumn
                                ? 70
                                : rowIndex < 3
                                  ? 55
                                  : isStickyColumn
                                    ? 20
                                    : isStickyRow
                                      ? 10
                                      : undefined,
                          };
                          return (
                            <td
                              key={`${rowIndex}-${cellIndex}`}
                              rowSpan={cell.rowSpan}
                              colSpan={cell.colSpan}
                              title={cell.text}
                              className={`border-b border-r border-slate-800/70 px-2 py-1 align-top ${
                                isDivider ? 'border-l-2 border-l-cyan-400/80' : ''
                              } ${isStickyColumn ? 'shadow-[1px_0_0_0_rgba(15,23,42,0.9)]' : ''}`}
                              style={finalStyle}
                            >
                              {cell.href ? (
                                <a
                                  href={cell.href}
                                  target="_blank"
                                  rel="noreferrer"
                                  className={`block leading-4 hover:underline ${allowOverflow ? 'whitespace-nowrap' : 'break-words'}`}
                                  style={{
                                    whiteSpace: allowOverflow ? 'nowrap' : cell.style?.['white-space'] || 'pre-wrap',
                                    fontWeight: cell.style?.['font-weight'] || (cell.bold ? '700' : undefined),
                                    textAlign: cellTextAlign,
                                  }}
                                >
                                  {cell.text || '\u00A0'}
                                </a>
                              ) : (
                                <div
                                  className={`${allowOverflow ? 'whitespace-nowrap' : 'break-words'} leading-4`}
                                  style={{
                                    whiteSpace: allowOverflow ? 'nowrap' : cell.style?.['white-space'] || 'pre-wrap',
                                    fontWeight: cell.style?.['font-weight'] || (cell.bold ? '700' : undefined),
                                    textAlign: cellTextAlign,
                                  }}
                                >
                                  {cell.text || '\u00A0'}
                                </div>
                              )}
                            </td>
                          );
                        })}
                      </tr>
                        );
                      })()
                    ))}
                    {!rows.length ? (
                      <tr>
                        <td className="px-4 py-10 text-sm text-slate-400">No sheet data loaded.</td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
            ) : (
              <div className="flex min-h-full items-center justify-center px-4 py-12">
                <div className="max-w-xl rounded-2xl border border-slate-700/60 bg-slate-900/80 px-5 py-4 text-center shadow-lg shadow-black/20">
                  <div className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-400">Load failed</div>
                  <div className="mt-2 text-sm text-slate-200">
                    No cached data and live fetch failed. Check source URL or script access.
                  </div>
                </div>
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
