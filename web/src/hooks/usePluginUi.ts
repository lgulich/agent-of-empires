import { useSyncExternalStore } from "react";

import { fetchPluginUiState, type PluginUiState } from "../lib/api";

const POLL_INTERVAL = 3000;

/// Module-level singleton store: every component using the hook shares one
/// 3s poller instead of fetching per subscriber (SessionRow renders per
/// session; per-row polling would hammer the endpoint).
let state: PluginUiState | null = null;
let listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;
let lastRevision = -1;

async function poll() {
  const next = await fetchPluginUiState();
  if (next && next.revision !== lastRevision) {
    lastRevision = next.revision;
    state = next;
    listeners.forEach((l) => l());
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (!timer) {
    void poll();
    timer = setInterval(() => void poll(), POLL_INTERVAL);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && timer) {
      clearInterval(timer);
      timer = null;
    }
  };
}

function getSnapshot(): PluginUiState | null {
  return state;
}

/** Shared, polled plugin UI state (entries + notifications); null until the
 *  first response arrives. */
export function usePluginUi(): PluginUiState | null {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/** Test hook: drop cached state so polls start fresh. */
export function resetPluginUiStoreForTests() {
  state = null;
  lastRevision = -1;
  listeners = new Set();
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
