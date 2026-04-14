// Shared cell and snapshot types used across all overview source loaders and the renderer.

export type OverviewCell = {
  text: string;
  href?: string;
  rowSpan?: number;
  colSpan?: number;
  style?: Record<string, string>;
  bold?: boolean;
};

export type OverviewSnapshot = {
  title: string;
  fetchedAt: number;
  rows: Array<Array<OverviewCell | null>>;
  rowHeights: Array<number | null>;
  columnWidths: Array<number | null>;
  mergedRanges?: Array<{
    row: number;
    col: number;
    numRows: number;
    numCols: number;
  }>;
};
