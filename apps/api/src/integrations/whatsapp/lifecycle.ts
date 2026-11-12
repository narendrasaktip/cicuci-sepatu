import type { WebState } from './web.js';

type LifecycleActivity = { action: string; entityType: string; metadata: { fromState: string; state: string; reason?: string; outcome?: string; stage?: string; errorType?: string; diagnosticCode?: string; operation?: string } };
// QR refreshes and heartbeat publications are not lifecycle changes.
export function lifecycleAudit(record: (activity: LifecycleActivity) => Promise<void>) {
  let previous = 'stopped'; let previousError: string | undefined;
  return (state: WebState) => {
    if (state.state === previous && state.error === previousError) return;
    const fromState = previous; previous = state.state; previousError = state.error;
    void record({ action: 'WA_STATE_CHANGED', entityType: 'WhatsApp', metadata: { fromState, state: state.state, ...(['error', 'disconnected'].includes(state.state) ? { outcome: 'FAILED' } : state.state === 'ready' ? { outcome: 'SUCCESS' } : {}), ...(state.error ? { reason: state.error } : {}), ...state.diagnostic } });
  };
}
