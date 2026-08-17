// @ts-nocheck
/**
 * Entrypoint for the TokenMeter sidebar TUI plugin.
 *
 * Wires the session/message/part events into the usage store, loads the
 * plugin-owned settings (the `settings.v1` object plus the
 * `sidebar.expanded` Subagents key) once at startup, and registers the
 * append-mode sidebar_content slot that renders the TokenMeter panel. The
 * sidebar width comes from the slot props/context width chain (fallback 38,
 * clamped 24–52). The same registration also fills the host's
 * `session_prompt_right` slot: the host keeps its SINGLE native
 * `api.ui.Prompt` (whose own bottom status row already renders native usage,
 * so the `session_prompt` replace slot is deliberately NOT registered — a
 * plugin-side prompt re-render or appended status row would duplicate it)
 * and renders the compact single-line SessionPromptRight inline at the right
 * end of the prompt's agent/model row — the active session's OWN usage only
 * (never the delegation tree), tracked from the slot's `session_id` prop and
 * pulsed by the reconcile snapshot.
 *
 * Lifecycle: the active session is tracked reactively by reading
 * api.route.current inside a Solid effect (the TUI exposes no session-select
 * event to plugins — tui.session.select is host-internal — so the route is
 * the supported change signal, per the reference plugin). The panel also
 * activates itself on first mount and on sessionID prop changes. Tool/part
 * activity (write/edit/patch/read/MCP/bash) arrives as message.part.updated
 * carrying part.sessionID; each refresh event invalidates the affected
 * session and schedules a debounced reconcile, so the next reconcile
 * REHYDRATES from the authoritative client session messages (replace, not
 * merge) — a stale in-memory mirror can never win over fresh client data.
 * Completed sessions (session.status idle / session.idle) are invalidated so
 * the next reconcile rehydrates their usage from the client messages — the
 * panel repaints without being remounted. session.created purges the whole
 * tree cache (parentID can be absent), and a 2s maintenance timer on the
 * active root re-discovers the child tree, so a delegated session that
 * became visible without any tree-invalidating event still lands in the
 * snapshot. Activating a root (route change or panel mount) force-refreshes
 * that root and its descendant tree instead of trusting a previously-loaded
 *  map. The Project section is debounce-refreshed on the same cadence (route
 *  changes and message/session/status/project events), resolved from the
 *  client project + session.list endpoints; its own failure
 *  leaves the Project placeholder and never breaks the Session panel. Project
 *  usage = authoritative live session.list sum + a persisted deleted-session
 *  aggregate in the plugin-owned SQLite store (tokenmeter.sqlite under
 *  api.state.path.state — never api.kv, which concurrent TUIs would
 *  clobber): session.deleted records the delete payload's usage (or the
 *  last known observed usage) into that aggregate BEFORE the refresh,
 *  atomically and exactly once per session across processes, and passes the
 *  deleted session's projectID as a refresh hint, so the Project section
 *  keeps its total even if project.current() is momentarily unresolved
 *  right after the delete. A bounded ~2 s polling timer refreshes Project on
 *  top of the event-driven fast path so a sibling OpenCode process working
 *  in the same project appears in this sidebar. The coins total is each
 *  session's complete
 *  per-session TOKEN SPEND (Σ input + Σ output + Σ reasoning + Σ
 *  cache.read + Σ cache.write across ALL assistant messages, reconstructing
 *  OpenCode's billed tokens.total; always >= input + output + reasoning). All
 *  signal and timer ownership lives inside a Solid createRoot, disposed with
 *  the plugin, per the reference plugin's ownership pattern.
 */
/** @jsxImportSource @opentui/solid */
import type { TuiPlugin } from "@opencode-ai/plugin/tui"
import { createEffect, createRoot } from "solid-js"
import { projectDbPath, recordDeletedSession } from "./tokenmeter/db"
import { UsagePanel } from "./tokenmeter/panel"
import { SessionPromptRight } from "./tokenmeter/panel/footer"
import { showSettingsDialog } from "./tokenmeter/panel/settings-dialog"
import {
  disposeProjectRefresh,
  scheduleProjectRefresh,
  startProjectPolling,
} from "./tokenmeter/project"
import {
  activateRoot,
  disposeReconcile,
  IDLE_DELAY,
  RECONCILE_DELAY,
  scheduleReconcile,
} from "./tokenmeter/reconcile"
import {
  cycleSubagents,
  loadSettings,
  subagentsPref,
} from "./tokenmeter/settings"
import {
  disposeToggleLayer,
  loadToggleShortcut,
  registerToggleLayer,
} from "./tokenmeter/shortcut"
import {
  forgetSession,
  invalidateUsage,
  observedSessionUsage,
  removeMessageUsage,
  setStatus,
  upsertMessageUsage,
} from "./tokenmeter/store"
import { clampSidebarWidth, resolveSidebarWidth } from "./tokenmeter/text"
import { purgeTreeCache, rememberSession } from "./tokenmeter/tree"

const id = "tokenmeter"

const tui: TuiPlugin = async (api) => {
  createRoot((disposeRoot) => {
    // Load the plugin-owned preferences once at startup: the
    // object-backed settings and the Subagents durable key are sanitized
    // into per-field defaults; the panel seeds its disclosure from the
    // master.
    loadSettings(api)
    // The toggle-sections shortcut preference loads before the toggle layer
    // registers, so the startup binding reflects the persisted choice.
    loadToggleShortcut(api)
    // Palette command (spec: tokenmeter-command-palette), registered through
    // the modern keymap API: the host palette queries `namespace: "palette"`,
    // groups by `category` (`TokenMeter`), displays `title`, and dispatches
    // `name`. `run` opens the plugin-owned settings DialogSelect through
    // the shared settings-dialog seam (api.ui.dialog.replace) — there is no
    // in-panel settings screen. The returned disposer is released in the
    // lifecycle handler below. The legacy `api.command` surface is not used
    // for this command.
    const unregisterPalette = api.keymap.registerLayer({
      commands: [
        {
          name: "tokenmeter.settings",
          namespace: "palette",
          category: "TokenMeter",
          title: "TokenMeter: Settings",
          desc: "Open TokenMeter Settings",
          run: () => showSettingsDialog(api),
        },
      ],
    })
    // Toggle-sections layer (quick-direct feature): binds the configurable
    // shortcut (default ctrl+e) to the palette-visible toggle command and
    // re-registers on preference change (shortcut.ts) so a new binding takes
    // effect without a restart. The current layer disposer is tracked inside
    // shortcut.ts and released in the lifecycle handler below.
    registerToggleLayer(api)
    // The Project section refreshes on the same debounce cadence as the
    // Session reconcile: both are scheduled together so a single event burst
    // yields one repaint of the whole panel. The optional projectIDHint
    // (captured from a session.deleted payload) is passed through to the
    // Project refresh so a failing lookup right after a delete can recover
    // the snapshot from the ledger instead of showing an error.
    const refreshAll = (delay: number, projectIDHint?: string) => {
      scheduleReconcile(api, delay)
      scheduleProjectRefresh(api, delay, projectIDHint)
    }
    const disposers = [
      api.event.on("message.updated", (e) => {
        if (upsertMessageUsage(e.properties.info)) refreshAll(RECONCILE_DELAY)
      }),
      api.event.on("message.removed", (e) => {
        invalidateUsage(e.properties.sessionID)
        removeMessageUsage(e.properties.sessionID, e.properties.messageID)
        refreshAll(RECONCILE_DELAY)
      }),
      // Tool/part activity: ToolPart (write/edit/patch/read/bash/MCP),
      // PatchPart, FilePart and step-finish parts all stream through
      // message.part.updated with part.sessionID. Cheap invalidation plus a
      // debounced reconcile rehydrates the session's current messages.
      api.event.on("message.part.updated", (e) => {
        const part = e.properties.part
        if (
          !part?.sessionID ||
          part.type === "text" ||
          part.type === "reasoning"
        )
          return
        invalidateUsage(part.sessionID)
        refreshAll(RECONCILE_DELAY)
      }),
      api.event.on("message.part.removed", (e) => {
        invalidateUsage(e.properties.sessionID)
        refreshAll(RECONCILE_DELAY)
      }),
      api.event.on("session.created", (e) => {
        // parentID can be absent at creation time, so purge the whole tree
        // cache: a stale cached child list would hide the new session from
        // every later reconcile until the maintenance timer recovers it.
        purgeTreeCache()
        rememberSession(e.properties.info)
        refreshAll(RECONCILE_DELAY)
      }),
      api.event.on("session.updated", (e) => {
        rememberSession(e.properties.info)
        refreshAll(RECONCILE_DELAY)
      }),
      api.event.on("session.deleted", (e) => {
        const info = e.properties.info
        // Record the deleted session's final usage into the plugin-owned
        // SQLite aggregate BEFORE the refresh: payload fields (authoritative
        // server fields) merged per-component with the plugin's observed
        // usage, captured before the store forgets the session. The write is
        // atomic and exactly-once per session across processes (tombstone
        // admission), so deleting never changes the project total and a
        // duplicate/cascade event never inflates it. No kv readiness gate:
        // SQLite is owned by the plugin, not the host kv store.
        const observed = observedSessionUsage(info?.id)
        recordDeletedSession(
          projectDbPath(api.state.path.state),
          info,
          observed,
        )
        forgetSession(info?.id)
        // Pass the deleted session's projectID as a refresh hint: right after
        // a delete the context may not resolve project.current() yet, and the
        // refresh keeps the hinted projectID so it still sums the live list
        // plus the (already updated) deleted aggregate — no error flash.
        refreshAll(RECONCILE_DELAY, info?.projectID)
      }),
      api.event.on("session.status", (e) => {
        const status = e.properties.status
        setStatus(e.properties.sessionID, status.type)
        if (status.type === "idle") {
          invalidateUsage(e.properties.sessionID)
          refreshAll(IDLE_DELAY)
        } else {
          refreshAll(RECONCILE_DELAY)
        }
      }),
      api.event.on("session.idle", (e) => {
        setStatus(e.properties.sessionID, "idle")
        invalidateUsage(e.properties.sessionID)
        refreshAll(IDLE_DELAY)
      }),
      api.event.on("session.compacted", (e) => {
        invalidateUsage(e.properties.sessionID)
        refreshAll(RECONCILE_DELAY)
      }),
      api.event.on("session.error", (e) => {
        if (e.properties.sessionID) invalidateUsage(e.properties.sessionID)
        refreshAll(RECONCILE_DELAY)
      }),
      api.event.on("project.updated", () =>
        scheduleProjectRefresh(api, RECONCILE_DELAY),
      ),
      api.event.on("project.directories.updated", () =>
        scheduleProjectRefresh(api, RECONCILE_DELAY),
      ),
    ]
    // Route-reactive session activation: reading api.route.current inside a
    // Solid effect tracks the active session, so activation happens whenever
    // the session changes — not from a stale one-time prop read. The panel's
    // own onMount covers the first mount. Project refreshes on the same
    // route changes (root/project switch).
    createEffect(() => {
      const route = api.route.current
      if (route?.name !== "session") return
      const sessionID = route.params?.sessionID
      if (sessionID) {
        activateRoot(api, sessionID)
        scheduleProjectRefresh(api, RECONCILE_DELAY)
      }
    })
    // Single bounded polling timer (~2 s) for Project freshness across
    // sibling OpenCode processes working in the same project. Started once
    // per plugin, never overlaps an in-flight refresh, and is cleared by
    // disposeProjectRefresh in the lifecycle below.
    startProjectPolling(api)
    api.lifecycle.onDispose(() => {
      disposeReconcile()
      disposeProjectRefresh()
      unregisterPalette()
      disposeToggleLayer()
      for (const dispose of disposers) dispose()
      disposeRoot()
    })
    api.slots.register({
      order: 95,
      slots: {
        sidebar_content(ctx, props) {
          const sessionID = props?.session_id ?? ctx?.session_id
          if (!sessionID) return null
          const width = clampSidebarWidth(
            resolveSidebarWidth(props) ?? resolveSidebarWidth(ctx),
          )
          return (
            <UsagePanel
              api={api}
              sessionID={sessionID}
              subagentsPref={subagentsPref}
              onToggleSubagents={() => cycleSubagents(api)}
              theme={() => ctx.theme.current}
              width={width}
            />
          )
        },
        session_prompt_right(_ctx, props) {
          return <SessionPromptRight api={api} sessionID={props?.session_id} />
        },
      },
    })
  })
}

const plugin = { id, tui }
export default plugin
