import { Component, type ErrorInfo, type ReactNode } from 'react';
import { isChunkLoadError } from '../lib/pwa';

type State = { failed: boolean; missingFiles: boolean };

/**
 * Last-resort screen if rendering throws. Answers stay in sessionStorage, so a reload is safe.
 * A part of the site that failed to download (usually replaced by a newer release) gets its own,
 * calmer message: a reload fixes it.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { failed: false, missingFiles: false };

  static getDerivedStateFromError(error: unknown): State {
    return { failed: true, missingFiles: isChunkLoadError(error) };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Unexpected error', error, info.componentStack);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <main id="main" className="flex min-h-screen items-center justify-center bg-cream px-6">
        <div className="flex max-w-[520px] flex-col items-start gap-5 rounded-[16px] border border-line bg-white p-8 shadow-[0px_12px_30px_0px_rgba(45,9,20,0.07)]">
          <p className="font-sans text-[11px] font-extrabold uppercase tracking-[2px] text-brand">
            {this.state.missingFiles ? 'Refresh needed' : 'Something went wrong'}
          </p>
          <h1 className="font-display text-[34px] leading-[1.05] text-ink">
            {this.state.missingFiles ? 'This page needs a refresh.' : 'Sorry, this page stopped working.'}
          </h1>
          <p className="font-sans text-[15px] leading-[1.6] text-muted">
            {this.state.missingFiles
              ? 'The site was updated, or the connection dropped while this page was loading. Reload to continue. Any answers you already entered are saved on this device.'
              : 'Please reload the page. Any answers you already entered are saved on this device.'}
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="cursor-pointer rounded-full bg-brand px-6 py-3 font-sans text-[14px] font-bold text-white hover:bg-brand-hover"
          >
            Reload the page
          </button>
        </div>
      </main>
    );
  }
}
