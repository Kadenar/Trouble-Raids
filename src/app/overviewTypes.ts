import type { LoadSource } from '../lib/overviewView';
import type { OverviewCell, OverviewSnapshot } from '../lib/types';

export type LoadState = 'idle' | 'loading' | 'ready' | 'error';
export type ViewMode = 'all' | 'sub1' | 'sub2' | `player:${number}`;

export type CachedOverviewSnapshot = OverviewSnapshot & { source?: LoadSource };

export type PlayerViewOption = {
  columnIndex: number;
  label: string;
};

export type PlayerViewGroups = {
  sub1: PlayerViewOption[];
  sub2: PlayerViewOption[];
};

export type CachedOverviewSnapshotWithPlayers = CachedOverviewSnapshot & {
  playerViewGroups?: PlayerViewGroups;
};

export type ProjectedTable = {
  rows: Array<Array<OverviewCell | null>>;
  columnWidths: Array<number | null>;
  columnIndexes: number[];
};
