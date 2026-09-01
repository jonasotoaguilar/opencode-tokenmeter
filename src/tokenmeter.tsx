// @ts-nocheck
/**
 * TokenMeter TUI entry — wires events → store → reconcile → panel, loads
 * settings/pricing/shortcut, registers sidebar_content + session_prompt_right,
 * and drives Project via durable per-session checkpoints (outside the host
 * state directory) with ~30 s cross-process polling.
 */
/** @jsxImportSource @opentui/solid */
import type { TuiPlugin } from "@opencode-ai/plugin/tui"
import { createEffect, createRoot } from "solid-js"
import {
  BROWSER_COMMAND_DESC,
  BROWSER_COMMAND_NAME,
  BROWSER_COMMAND_TITLE,
  showBrowserDialog,
} from "./tokenmeter/browser/dialog"
import { checkpointDeletedSession } from "./tokenmeter/durable/deleted"
import { durableDbPath, normalizeAlias } from "./tokenmeter/durable/paths"
import { handleProjectMilestone } from "./tokenmeter/milestone"
import { UsagePanel } from "./tokenmeter/panel"
import { SessionPromptRight } from "./tokenmeter/panel/footer"
import { showSettingsDialog } from "./tokenmeter/panel/settings-dialog"
import { loadPricing } from "./tokenmeter/pricing"
import {
  disposeProjectRefresh,
  scheduleProjectRefresh,
  startProjectPolling,
  subscribeProjectSnapshot,
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
  settings,
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
    loadSettings(api)
    loadToggleShortcut(api)
    void loadPricing(api as unknown as Parameters<typeof loadPricing>[0]).catch(
      () => {},
    )

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
        {
          name: BROWSER_COMMAND_NAME,
          namespace: "palette",
          category: "TokenMeter",
          title: BROWSER_COMMAND_TITLE,
          desc: BROWSER_COMMAND_DESC,
          run: () =>
            showBrowserDialog(
              api as unknown as Parameters<typeof showBrowserDialog>[0],
            ),
        },
      ],
    })

    registerToggleLayer(api)

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
        const observed = observedSessionUsage(info?.id)
        try {
          const durablePath = durableDbPath()
          const alias = normalizeAlias(
            (info as unknown as { directory?: string })?.directory ??
              api.state.path.directory,
          )
          checkpointDeletedSession(durablePath, info, alias, observed)
        } catch {}
        forgetSession(info?.id)
        refreshAll(RECONCILE_DELAY, info?.projectID)
      }),
      api.event.on("session.status", (e) => {
        const status = e.properties.status
        setStatus(e.properties.sessionID, status.type)
        if (status.type === "idle") {
          invalidateUsage(e.properties.sessionID)
          refreshAll(IDLE_DELAY)
        } else refreshAll(RECONCILE_DELAY)
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

    createEffect(() => {
      const route = api.route.current
      if (route?.name !== "session") return
      const sessionID = route.params?.sessionID
      if (sessionID) {
        activateRoot(api, sessionID)
        scheduleProjectRefresh(api, RECONCILE_DELAY)
      }
    })

    const disposeMilestone = subscribeProjectSnapshot((snap) => {
      if (snap) handleProjectMilestone(api, snap)
    })

    startProjectPolling(api)

    api.lifecycle.onDispose(() => {
      disposeMilestone()
      disposeReconcile()
      disposeProjectRefresh()
      unregisterPalette()
      disposeToggleLayer()
      for (const d of disposers) d()
      disposeRoot()
    })

    api.slots.register({
      order: 95,
      slots: {
        sidebar_content(ctx, props) {
          const sessionID = props?.session_id ?? ctx?.session_id
          if (!sessionID) return null
          if (!settings().visibility.sidebar) return null
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
