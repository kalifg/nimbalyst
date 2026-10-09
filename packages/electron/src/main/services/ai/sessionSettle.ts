import { getSessionStateManager } from '@nimbalyst/runtime/ai/server/SessionStateManager';
import { getQueuedPromptsStore, getSessionWakeupsStore } from '../RepositoryManager';
import { isLeadTurnPending } from './drainFollowUp';

const SETTLE_POLL_MS = 30_000;
// A single ScheduleWakeup can wait an hour; past this the run is reported as
// still running rather than holding the caller indefinitely (#1685).
const SETTLE_TIMEOUT_MS = 6 * 60 * 60_000;

const TURN_END_EVENTS = new Set(['session:completed', 'session:error', 'session:interrupted']);

/**
 * True while the session still has work that will produce another turn: a turn
 * in flight or waiting on the user, a background-results wake, a queued or
 * executing prompt, or a scheduled wakeup.
 */
async function hasPendingWork(sessionId: string): Promise<boolean> {
  const status = getSessionStateManager().getSessionState(sessionId)?.status;
  if (status === 'running' || status === 'waiting_for_input') return true;
  if (isLeadTurnPending(sessionId)) return true;
  if ((await getQueuedPromptsStore().listForSession(sessionId)).length > 0) return true;
  return (await getSessionWakeupsStore().listActiveForSession(sessionId)).length > 0;
}

/**
 * Resolves once the session has no pending work. Returns false when it was
 * already settled, so callers can keep the turn result they already have.
 * Re-checks on every turn end and on a slow poll, since a cancelled wakeup
 * emits no session event.
 */
export async function waitForSessionToSettle(sessionId: string): Promise<boolean> {
  let recheck = () => {};
  const unsubscribe = getSessionStateManager().subscribe((event) => {
    if (event.sessionId === sessionId && TURN_END_EVENTS.has(event.type)) recheck();
  });
  try {
    if (!(await hasPendingWork(sessionId))) return false;
    const deadline = Date.now() + SETTLE_TIMEOUT_MS;
    for (;;) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        throw new Error(`Session ${sessionId} is still running after ${SETTLE_TIMEOUT_MS / 3_600_000} hours`);
      }
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, Math.min(SETTLE_POLL_MS, remaining));
        recheck = () => {
          clearTimeout(timer);
          resolve();
        };
      });
      if (!(await hasPendingWork(sessionId))) return true;
    }
  } finally {
    unsubscribe();
  }
}
