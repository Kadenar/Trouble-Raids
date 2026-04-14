import type { LoadSource } from '../../lib/overviewView';
import type { LoadState } from '../overviewTypes';

type Props = {
  loadState: LoadState;
  lastLoadedAt: number | null;
  loadSource: LoadSource | null;
  error: string;
};

export function LoadStatusBar({ loadState, lastLoadedAt, loadSource, error }: Props) {
  return (
    <aside className="rounded-2xl border border-slate-700/60 bg-slate-900/80 p-3 shadow-lg shadow-black/20 md:w-20 md:flex-none">
      <div className="flex h-full min-h-0 flex-col items-start gap-3 md:items-center">
        <div className="flex flex-wrap gap-2 text-[8px] font-semibold uppercase tracking-[0.12em] md:flex-col md:gap-2">
          <span className="rounded-full border border-slate-700 bg-slate-950/60 px-2.5 py-0.5 text-slate-300">
            {loadState === 'ready' ? 'Loaded' : loadState === 'loading' ? 'Loading' : loadState === 'error' ? 'Error' : 'Idle'}
          </span>
          <span className="rounded-full border border-slate-700 bg-slate-950/60 px-2.5 py-0.5 text-slate-300">
            {lastLoadedAt ? new Date(lastLoadedAt).toLocaleString() : 'Not loaded'}
          </span>
          <span className="rounded-full border border-slate-700 bg-slate-950/60 px-2.5 py-0.5 text-slate-300">
            {loadSource === 'apps-script'
              ? 'Apps Script'
              : loadSource === 'html-fallback'
                ? 'HTML fallback'
                : 'Source unknown'}
          </span>
        </div>
        {error ? <div className="text-sm text-rose-200">{error}</div> : null}
      </div>
    </aside>
  );
}
