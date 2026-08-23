import { Component } from 'react';

/**
 * Last line of defence. A crash inside one route should not leave the user
 * staring at a blank page with no way back.
 */
export default class ErrorBoundary extends Component {
  state = { error: null };

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // eslint-disable-next-line no-console
    console.error('TypeForge crashed:', error, info);
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div className="grid min-h-dvh place-items-center p-3">
        <div className="max-w-[440px] rounded-lg border border-line bg-surface p-3 text-center shadow-md">
          <p className="font-mono text-3xl">⌘</p>
          <h1 className="mt-1 text-xl font-extrabold">Something broke mid-keystroke</h1>
          <p className="mt-1 text-sm text-ink-3">
            Your progress is saved locally and is unaffected. Reloading usually clears it.
          </p>
          <pre className="mt-2 max-h-[120px] overflow-auto rounded-sm bg-subtle p-1.5 text-left font-mono text-xs text-ink-2">
            {String(this.state.error?.message ?? this.state.error)}
          </pre>
          <button
            onClick={() => window.location.reload()}
            className="mt-2 h-[40px] rounded-sm bg-ink px-2.5 text-sm font-bold text-bg dark:bg-brand-solid dark:text-brand-ink"
          >
            Reload
          </button>
        </div>
      </div>
    );
  }
}
