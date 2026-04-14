import { useEffect, useRef, useState } from 'react';
import { getColumnLetter } from '../../lib/overviewView';
import type { ViewMode, PlayerViewGroups, PlayerViewOption } from '../overviewTypes';

type Props = {
  viewMode: ViewMode;
  selectedViewLabel: string;
  showPlayerViews: boolean;
  effectivePlayerViewGroups: PlayerViewGroups;
  selectedPlayer: PlayerViewOption | null;
  onViewModeChange: (mode: ViewMode) => void;
};

export function ViewModeMenu({
  viewMode,
  selectedViewLabel,
  showPlayerViews,
  effectivePlayerViewGroups,
  selectedPlayer,
  onViewModeChange,
}: Props) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: MouseEvent) => {
      if (!menuRef.current || menuRef.current.contains(event.target as Node)) return;
      setOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  const select = (mode: ViewMode) => {
    onViewModeChange(mode);
    setOpen(false);
  };

  const allPlayers = [...effectivePlayerViewGroups.sub1, ...effectivePlayerViewGroups.sub2];

  const disambiguate = (player: PlayerViewOption) => {
    const count = allPlayers.filter((p) => p.label === player.label).length;
    return count > 1 ? `${player.label} (${getColumnLetter(player.columnIndex)})` : player.label;
  };

  return (
    <div ref={menuRef} className="relative z-[300]">
      <span className="mr-2 text-[8px] font-semibold uppercase tracking-[0.16em] text-slate-500">View</span>
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="inline-flex items-center gap-2 rounded-full border border-slate-700 bg-slate-950/60 px-3 py-1 text-[8px] font-semibold uppercase tracking-[0.12em] text-slate-200 outline-none transition hover:bg-slate-900"
      >
        <span>{selectedViewLabel}</span>
        <svg
          aria-hidden="true"
          viewBox="0 0 20 20"
          fill="currentColor"
          className={`h-3 w-3 text-slate-400 transition ${open ? 'rotate-180' : ''}`}
        >
          <path
            fillRule="evenodd"
            d="M5.23 7.21a.75.75 0 0 1 1.06.02L10 10.94l3.71-3.71a.75.75 0 1 1 1.06 1.06l-4.24 4.25a.75.75 0 0 1-1.06 0L5.21 8.29a.75.75 0 0 1 .02-1.08Z"
            clipRule="evenodd"
          />
        </svg>
      </button>

      {open ? (
        <div className="absolute right-0 top-[calc(100%+0.4rem)] z-[400] w-72 overflow-hidden rounded-2xl border border-slate-700/70 bg-slate-950/95 shadow-2xl shadow-black/40 backdrop-blur">
          <div className="max-h-96 overflow-auto p-1">
            <button
              type="button"
              onClick={() => select('all')}
              className={`flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-[0.16em] transition ${
                viewMode === 'all' ? 'bg-cyan-400/15 text-cyan-100' : 'text-slate-200 hover:bg-slate-900'
              }`}
            >
              <span>All</span>
            </button>

            <button
              type="button"
              onClick={() => select('sub1')}
              className={`mt-1 flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-[0.16em] transition ${
                viewMode === 'sub1' ||
                (selectedPlayer &&
                  effectivePlayerViewGroups.sub1.some((p) => p.columnIndex === selectedPlayer.columnIndex))
                  ? 'bg-cyan-400/15 text-cyan-100'
                  : 'text-slate-200 hover:bg-slate-900'
              }`}
            >
              <span>Sub 1</span>
            </button>
            {showPlayerViews && effectivePlayerViewGroups.sub1.length ? (
              <div className="pl-3 pt-1">
                <div className="mb-1 text-[9px] font-semibold uppercase tracking-[0.18em] text-slate-500">Players</div>
                <div className="space-y-1">
                  {effectivePlayerViewGroups.sub1.map((player) => (
                    <button
                      key={`sub1-${player.columnIndex}`}
                      type="button"
                      onClick={() => select(`player:${player.columnIndex}`)}
                      className={`flex w-full rounded-xl px-3 py-2 text-left text-[10px] font-medium transition ${
                        viewMode === `player:${player.columnIndex}`
                          ? 'bg-cyan-400/15 text-cyan-100'
                          : 'text-slate-300 hover:bg-slate-900'
                      }`}
                    >
                      {disambiguate(player)}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            <button
              type="button"
              onClick={() => select('sub2')}
              className={`mt-2 flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-[0.16em] transition ${
                viewMode === 'sub2' ||
                (selectedPlayer &&
                  effectivePlayerViewGroups.sub2.some((p) => p.columnIndex === selectedPlayer.columnIndex))
                  ? 'bg-cyan-400/15 text-cyan-100'
                  : 'text-slate-200 hover:bg-slate-900'
              }`}
            >
              <span>Sub 2</span>
            </button>
            {showPlayerViews && effectivePlayerViewGroups.sub2.length ? (
              <div className="pl-3 pt-1">
                <div className="mb-1 text-[9px] font-semibold uppercase tracking-[0.18em] text-slate-500">Players</div>
                <div className="space-y-1">
                  {effectivePlayerViewGroups.sub2.map((player) => (
                    <button
                      key={`sub2-${player.columnIndex}`}
                      type="button"
                      onClick={() => select(`player:${player.columnIndex}`)}
                      className={`flex w-full rounded-xl px-3 py-2 text-left text-[10px] font-medium transition ${
                        viewMode === `player:${player.columnIndex}`
                          ? 'bg-cyan-400/15 text-cyan-100'
                          : 'text-slate-300 hover:bg-slate-900'
                      }`}
                    >
                      {disambiguate(player)}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
