import type { CSSProperties } from 'react';
import type { OverviewCell } from '../../lib/types';
import type { WingTheme, DividerPlacement } from '../../lib/overviewView';
import { cellStyle, getColumnLetter, getStickyRowTop, shouldAllowTextOverflow } from '../../lib/overviewView';
import type { ProjectedTable } from '../overviewTypes';

type ThemedRow = {
  row: Array<OverviewCell | null>;
  theme: WingTheme;
};

type Props = {
  projected: ProjectedTable;
  themedRows: ThemedRow[];
  rowHeights: Array<number | null>;
  divider: DividerPlacement | null;
  tableMinWidth: number;
  headerRowHeight: number;
  hasRows: boolean;
};

export function RaidTable({ projected, themedRows, rowHeights, divider, tableMinWidth, headerRowHeight, hasRows }: Props) {
  return (
    <table
      className="table-fixed border-separate border-spacing-0 text-[10px]"
      style={{ minWidth: `${tableMinWidth}px`, width: 'max-content' }}
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
            const letter = getColumnLetter(index);
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

        {themedRows.map(({ row, theme }, rowIndex) => {
          const stickyTop = getStickyRowTop(rowIndex, rowHeights);
          const isStickyRow = stickyTop !== undefined;
          return (
            <tr
              key={rowIndex}
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
                const allowOverflow = shouldAllowTextOverflow(cell);
                const centeredOverflowText = allowOverflow && !cell.style?.['text-align'] ? 'center' : cell.style?.['text-align'];
                const cellTextAlign = (centeredOverflowText || cell.style?.['text-align'] || undefined) as CSSProperties['textAlign'];
                const finalStyle: CSSProperties = {
                  ...cellStyle(cell, width, height),
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
                const contentStyle = {
                  whiteSpace: (allowOverflow ? 'nowrap' : cell.style?.['white-space'] || 'pre-wrap') as CSSProperties['whiteSpace'],
                  fontWeight: cell.style?.['font-weight'] || (cell.bold ? '700' : undefined),
                  textAlign: cellTextAlign,
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
                        style={contentStyle}
                      >
                        {cell.text || '\u00A0'}
                      </a>
                    ) : (
                      <div
                        className={`${allowOverflow ? 'whitespace-nowrap' : 'break-words'} leading-4`}
                        style={contentStyle}
                      >
                        {cell.text || '\u00A0'}
                      </div>
                    )}
                  </td>
                );
              })}
            </tr>
          );
        })}

        {!hasRows ? (
          <tr>
            <td className="px-4 py-10 text-sm text-slate-400">No sheet data loaded.</td>
          </tr>
        ) : null}
      </tbody>
    </table>
  );
}
