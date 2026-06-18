import { useCallback, useEffect, useRef, useState } from "react";
import { useIsCoarsePointer } from "../hooks/useIsCoarsePointer";
import { useLiveTerminal } from "../hooks/useLiveTerminal";
import { useMobileKeyboard } from "../hooks/useMobileKeyboard";
import { MobileTerminalToolbar } from "./MobileTerminalToolbar";
import { MobileLiveTerminal } from "./MobileLiveTerminal";
import { KeyboardFab } from "./KeyboardFab";
import { TerminalConnectionBanners } from "./TerminalConnectionBanners";
import { LiveTerminalView } from "./LiveTerminalView";
import { closePluginPane, fetchPlugins, listPluginPanes, openPluginPane, type PluginPaneHandle } from "../lib/api";
import type { SessionResponse } from "../lib/types";

type ShellMode = "host" | "container";

/** A plugin-owned terminal pane rendered through the capture-snapshot live
 *  view (same architecture as the agent and paired shells). The handle IS the
 *  pane's tmux session, which the host already spawned at open time, so there
 *  is no ensure/boot step: this connects directly to the absolute
 *  `/api/plugin-panes/<handle>/ws` live relay. */
function PluginPaneTerminal({ handle }: { handle: string }) {
  const coarse = useIsCoarsePointer();
  const live = useLiveTerminal(handle, `/api/plugin-panes/${handle}/ws`);
  const { keyboardHeight } = useMobileKeyboard();
  const [inputFocused, setInputFocused] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const [ctrlActive, setCtrlActive] = useState(false);
  const ctrlActiveRef = useRef(false);
  useEffect(() => {
    ctrlActiveRef.current = ctrlActive;
  }, [ctrlActive]);

  const focusSelf = useCallback(() => {
    const ta = inputRef.current;
    if (ta) {
      ta.focus();
      return true;
    }
    return false;
  }, []);

  const toggleKeyboard = useCallback(() => {
    const ta = inputRef.current;
    if (!ta) return;
    if (inputFocused) ta.blur();
    else ta.focus();
  }, [inputFocused]);

  const rootStyle = keyboardHeight > 0 ? { paddingBottom: keyboardHeight } : undefined;

  return (
    <div
      className="flex-1 flex flex-col overflow-hidden relative"
      style={rootStyle}
      data-term="plugin-pane"
      data-pane-focused={inputFocused || undefined}
    >
      <div
        aria-hidden="true"
        className={`pointer-events-none absolute inset-0 z-10 ring-inset transition-shadow ${
          inputFocused ? "ring-2 ring-terminal-active" : "ring-1 ring-surface-700/40"
        }`}
      />

      <TerminalConnectionBanners
        connected={live.state.connected}
        reconnecting={live.state.reconnecting}
        retryCount={live.state.retryCount}
        retryCountdown={live.state.retryCountdown}
        maxRetries={live.maxRetries}
        onRetry={live.manualReconnect}
      />

      {live.state.connected && !live.state.isOwner && (
        <div className="absolute left-0 right-0 top-3 flex justify-center z-20 px-3">
          <button
            type="button"
            onClick={live.claim}
            data-live-takeover
            className="flex items-center gap-1.5 text-xs font-semibold text-white bg-brand-600 hover:bg-brand-500 active:bg-brand-700 border border-brand-400/50 rounded-full px-4 py-2 shadow-lg cursor-pointer animate-fade-in"
          >
            <svg
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M9 18l6-6-6-6" />
            </svg>
            Live on another device. Take over
          </button>
        </div>
      )}

      <div
        className="flex-1 overflow-hidden bg-[var(--term-bg)] relative"
        onClick={() => {
          if (coarse) return;
          const sel = window.getSelection();
          if (sel && !sel.isCollapsed) return;
          focusSelf();
        }}
      >
        <MobileLiveTerminal
          frame={live.state.frame}
          connected={live.state.connected}
          active={true}
          reading={live.state.reading}
          sendResize={live.sendResize}
          setWindow={live.setWindow}
          setCadence={live.setCadence}
          enterReading={live.enterReading}
          returnToLive={live.returnToLive}
          sendData={live.sendData}
          forwardWheel={live.forwardWheel}
          ctrlActiveRef={ctrlActiveRef}
          clearCtrl={() => setCtrlActive(false)}
          inputRef={inputRef}
          onInputFocusChange={setInputFocused}
          bottomAlign={false}
        />
        {coarse && live.state.connected && <KeyboardFab keyboardOpen={inputFocused} onToggle={toggleKeyboard} />}
      </div>

      {coarse && live.state.connected && (
        <MobileTerminalToolbar
          sendData={live.sendData}
          inputElRef={inputRef}
          keyboardOpen={inputFocused}
          ctrlActive={ctrlActive}
          onCtrlToggle={() => setCtrlActive((v) => !v)}
        />
      )}
    </div>
  );
}

/** A declared pane the user can open, with the owning plugin id. */
interface DeclaredPane {
  pluginId: string;
  paneId: string;
  title: string;
}

/** Host/container shell switch plus the paired terminal. Used both in the
 *  desktop right-panel split and as the promoted single full-viewport mobile
 *  pane. Renders the capture-snapshot live view on every device (same
 *  architecture as the agent pane); the xterm.js PTY relay was removed.
 *  Plugin-owned panes (#268) appear as extra tabs alongside the shell. */
export function PairedShellPane({ session, sessionId }: { session: SessionResponse | null; sessionId: string | null }) {
  const [shellMode, setShellMode] = useState<ShellMode>("host");
  // `null` means a shell tab (host/container) is active; otherwise the active
  // plugin pane handle.
  const [activePane, setActivePane] = useState<string | null>(null);
  const [declared, setDeclared] = useState<DeclaredPane[]>([]);
  const [openPanes, setOpenPanes] = useState<PluginPaneHandle[]>([]);
  const [menuOpen, setMenuOpen] = useState(false);
  const isSandboxed = session?.is_sandboxed ?? false;

  // Declared panes come from the active plugin set (global).
  useEffect(() => {
    let cancelled = false;
    void fetchPlugins().then((list) => {
      if (cancelled || !list) return;
      const decls = list.plugins
        .filter((p) => p.active)
        .flatMap((p) => (p.panes ?? []).map((pane) => ({ pluginId: p.id, paneId: pane.id, title: pane.title })));
      setDeclared(decls);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Reset pane state during render when the session changes (the effect-key
  // pattern PairedTerminal uses; avoids set-state-in-effect).
  const [trackedSession, setTrackedSession] = useState(sessionId);
  if (sessionId !== trackedSession) {
    setTrackedSession(sessionId);
    setActivePane(null);
    setOpenPanes([]);
  }

  // Open panes are session-scoped; re-discover them when the session changes
  // so a dashboard refresh or a session switch re-attaches the right ones.
  useEffect(() => {
    if (!sessionId) return;
    let cancelled = false;
    void listPluginPanes().then((panes) => {
      if (cancelled) return;
      setOpenPanes(panes.filter((p) => p.session_id === sessionId));
    });
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  const handleOpen = useCallback(
    async (decl: DeclaredPane) => {
      setMenuOpen(false);
      const opened = await openPluginPane(decl.pluginId, decl.paneId, sessionId);
      if (!opened) return;
      setOpenPanes((prev) => (prev.some((p) => p.handle === opened.handle) ? prev : [...prev, opened]));
      setActivePane(opened.handle);
    },
    [sessionId],
  );

  const handleClose = useCallback(async (handle: string) => {
    await closePluginPane(handle);
    setOpenPanes((prev) => prev.filter((p) => p.handle !== handle));
    setActivePane((cur) => (cur === handle ? null : cur));
  }, []);

  const shellTabClass = (active: boolean) =>
    `text-[12px] px-2 py-0.5 rounded cursor-pointer transition-colors ${
      active ? "text-brand-500 bg-brand-600/10" : "text-text-dim hover:text-text-muted"
    }`;

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
      <div className="flex items-center gap-1 px-2 py-1 bg-surface-900 border-b border-surface-700/20 shrink-0">
        <span className="text-xs text-text-dim mr-1">Shell</span>
        <button
          onClick={() => {
            setShellMode("host");
            setActivePane(null);
          }}
          className={shellTabClass(activePane === null && shellMode === "host")}
        >
          Host
        </button>
        {isSandboxed && (
          <button
            onClick={() => {
              setShellMode("container");
              setActivePane(null);
            }}
            className={shellTabClass(activePane === null && shellMode === "container")}
          >
            Container
          </button>
        )}
        {openPanes.map((p) => (
          <span key={p.handle} className={shellTabClass(activePane === p.handle)}>
            <button onClick={() => setActivePane(p.handle)} className="cursor-pointer">
              {p.title}
            </button>
            <button
              onClick={() => void handleClose(p.handle)}
              aria-label={`Close ${p.title}`}
              className="ml-1 cursor-pointer text-text-dim hover:text-status-error"
            >
              ×
            </button>
          </span>
        ))}
        {declared.length > 0 && (
          <div className="relative ml-auto">
            <button
              onClick={() => setMenuOpen((o) => !o)}
              aria-label="Open plugin pane"
              className="text-[12px] px-2 py-0.5 rounded cursor-pointer text-text-dim hover:text-text-muted"
            >
              + Pane
            </button>
            {menuOpen && (
              <div className="absolute right-0 z-10 mt-1 min-w-40 rounded border border-surface-700/60 bg-surface-900 py-1 shadow-lg">
                {declared.map((d) => (
                  <button
                    key={`${d.pluginId}:${d.paneId}`}
                    onClick={() => void handleOpen(d)}
                    className="block w-full px-3 py-1 text-left text-[12px] text-text-muted hover:bg-brand-600/10 hover:text-brand-500 cursor-pointer"
                  >
                    {d.title}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {!sessionId || !session ? (
        <div className="flex-1 flex items-center justify-center bg-surface-950 text-text-dim">
          <p className="text-xs">Select a session</p>
        </div>
      ) : activePane ? (
        <PluginPaneTerminal key={activePane} handle={activePane} />
      ) : (
        <LiveTerminalView
          key={`${sessionId}-${shellMode}`}
          session={session}
          surface={shellMode === "container" ? "paired-container" : "paired-host"}
        />
      )}
    </div>
  );
}
