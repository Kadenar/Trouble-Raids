import { Component, type ErrorInfo, type ReactNode } from 'react';

type Props = {
  children: ReactNode;
};

type State = {
  error: Error | null;
};

// Catches render errors in the component tree and shows a fallback instead of a blank screen.
// React error boundaries must be class components — hooks cannot catch render errors.
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ErrorBoundary]', error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex min-h-screen items-center justify-center bg-slate-950 px-4 text-slate-100">
          <div className="max-w-lg rounded-2xl border border-rose-700/60 bg-slate-900/80 px-6 py-5 shadow-lg shadow-black/30">
            <div className="text-xs font-semibold uppercase tracking-[0.24em] text-rose-400">
              Something went wrong
            </div>
            <div className="mt-2 text-sm text-slate-200">
              The overview failed to render. This usually means the sheet format changed in an unexpected way.
            </div>
            <pre className="mt-3 max-h-40 overflow-auto rounded-lg bg-slate-950 px-3 py-2 text-[10px] text-rose-300">
              {this.state.error.message}
            </pre>
            <button
              type="button"
              onClick={() => this.setState({ error: null })}
              className="mt-4 rounded-full border border-slate-700 bg-slate-800 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-200 transition hover:bg-slate-700"
            >
              Try again
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
