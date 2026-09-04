// @ts-nocheck
/** @jsxImportSource @opentui/solid */
/**
 * TokenMeter sidebar panel component — stable module entry; consumers import
 * `UsagePanel` from `./tokenmeter/panel` (resolves to this file).
 *
 * Layout, top to bottom:
 *   `▶/▼ TokenMeter` — master disclosure row: the chevron (`▶` collapsed /
 *     `▼` expanded) is the LEFTMOST glyph, then the title; chevron OR
 *     title-text click toggles the master state (transient — starts
 *     EXPANDED, resets on session change, never kv). Collapsed renders
 *     `▶ TokenMeter` plus EXACTLY ONE compact summary — the elastic L1 of
 *     the persisted `collapsedSummary` source (session or project) — and no
 *     other rows. There is no title-row toggle and no in-panel settings
 *     view: the palette command opens the settings DialogSelect
 *     (settings-dialog.tsx) and the metric body never changes.
 *   Project and Session sections render through the shared Section component
 *     (section.tsx): compact by default — ONE summary row (`<total> tokens ·
 *     $<spend>`, nested two columns under the heading) — with an
 *     independent chevron toggle per section
 *     (chevron OR section title-text click). The heading TITLE texts
 *     Project and Session render in the semantic yellow `theme().warning`;
 *     the leading disclosure chevrons stay in the main-text tone. Section
 *     disclosure is
 *     transient: sections seed CLOSED at mount (the former
 *     disclosure-seeding field was removed with the settings model —
 *     tokenmeter-settings spec; the master disclosure replaces it), reset
 *     to closed on session change, never written to kv. Project shows the
 *     stable error line (project-section.tsx) while Session is unaffected.
 *   Subagents — ONE left-chevron global row: `▶ Subagents (N agents · M
 *     tasks)` collapsed, `▼ Subagents` (no aggregate — the list is the
 *     detail) expanded; the title text renders in the semantic yellow
 *     `theme().warning` like the section titles. Clicking
 *     the row cycles the durable
 *     `tokenmeter.sidebar.expanded` preference via the entry-passed handler.
 *     Expanded, ALL groups render inside a real `<scrollbox>` sized for
 *     up to three collapsed agent entries (viewport 6); nothing is sliced
 *     and no clipped cue is rendered. One wheel gesture always advances
 *     exactly two rows via the declarative scroll acceleration. Each compact
 *     agent entry (GroupRows,
 *     group-rows.tsx) is a `↳`-indented header
 *     `↳ <name> (<T> tasks) ▶` whose per-agent chevron trails the header
 *     and flips `▼` while open, plus its elastic
 *     compact L1; clicking an entry
 *     replaces its compact lines with the mode-aware detail rows (compact:
 *     three, precise: five — L1 once). Toggling an agent reveals its full
 *     entry: the scrollbox moves the minimum distance needed to show the
 *     whole expanded entry. Exclusivity is index-keyed
 *     (`openGroupIndex: number | null`): opening one agent closes the other
 *     and clicking the open agent closes it; the open agent is transient —
 *     reset on mount/session change, never written to kv.
 *
 * The panel has NO screen seam: every rendered row is the metric body (or
 * the master-collapsed summary). The preference menu lives in the palette
 * DialogSelect (spec: tokenmeter-command-palette — no title-row toggle
 * text, no in-panel view may replace the metric body); the old in-panel
 * screen module was deleted with the seam. Every line is column-aware and
 * truncated to the content width passed in from the sidebar_content slot
 * ctx/props. Activation runs once on mount so the panel populates on first
 * open, then again on session route changes.
 */
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  on,
  onMount,
  Show,
} from "solid-js"
import { formatCount } from "../format"
import { GLYPH } from "../glyphs"
import { projectSnapshot, scheduleProjectRefresh } from "../project"
import { activateRoot } from "../reconcile"
import {
  projectOpen,
  resetSectionDisclosure,
  sessionOpen,
  setSectionOpen,
} from "../sections"
import { type NumbersPref, settings } from "../settings"
import { snapshot } from "../store"
import { contentWidth, truncateToColumns } from "../text"
import { GroupRows } from "./group-rows"
import { Section, SectionSummary } from "./section"

// Row geometry of one agent entry — the single height truth shared by the
// viewport size and the toggle reveal: collapsed is 2 rows (header +
// compact L1), expanded compact is 4 (header + 3 detail), expanded precise
// is 6 (header + 5 detail).
const COLLAPSED_AGENT_ROWS = 2
const COMPACT_OPEN_AGENT_ROWS = 4
const PRECISE_OPEN_AGENT_ROWS = 6
// The scrollbox shows up to three collapsed agents.
const SUBAGENTS_VIEWPORT_ROWS = 6

function agentEntryRows(open: boolean, numbers: NumbersPref): number {
  if (!open) return COLLAPSED_AGENT_ROWS
  return numbers === "precise"
    ? PRECISE_OPEN_AGENT_ROWS
    : COMPACT_OPEN_AGENT_ROWS
}

export function UsagePanel(props) {
  const theme = () => props.theme()
  const inner = () => contentWidth(props.width ?? 38)

  // Master disclosure is transient: starts EXPANDED (the resolved contract —
  // preserves the previous default), resets to expanded on session change,
  // never written to kv. Collapsed renders `▶ TokenMeter` plus EXACTLY ONE
  // compact summary — the elastic L1 of the persisted `collapsedSummary`
  // source (session or project) — and no other rows.
  const [masterCollapsed, setMasterCollapsed] = createSignal(false)
  const masterChevron = () =>
    masterCollapsed() ? GLYPH.expand : GLYPH.collapse
  const toggleMaster = () => setMasterCollapsed(!masterCollapsed())

  // Section disclosure lives in the shared sections.ts store so the
  // `tokenmeter.toggle-sections` command (shortcut.ts) can expand/collapse
  // the sections together: sections seed closed at mount (the removed
  // legacy seeding is superseded by the master disclosure), reset to closed
  // on every session change, never written to kv.

  // Open agent of the Subagents accordion, keyed by group INDEX inside the
  // current snapshot's sorted list. Transient like the section disclosure:
  // null at mount, reset on session change, never written to kv. Index
  // exclusivity makes the one-open accordion true by construction.
  const [openGroupIndex, setOpenGroupIndex] = createSignal<number | null>(null)

  // Initial activation on first mount: the panel must reconcile and populate
  // as soon as it opens, without depending on a reactive prop change. The
  // deferred effect below covers later sessionID prop updates.
  onMount(() => {
    activateRoot(props.api, props.sessionID)
    scheduleProjectRefresh(props.api)
    // Mount is the closed seed for the shared transient disclosure (the
    // signals are module-level so a fresh mount never inherits a previous
    // panel's open state).
    resetSectionDisclosure()
  })
  createEffect(
    on(
      () => props.sessionID,
      (sid) => {
        activateRoot(props.api, sid)
        setMasterCollapsed(false)
        resetSectionDisclosure()
        setOpenGroupIndex(null)
      },
      { defer: true },
    ),
  )

  const view = createMemo(() => {
    const snap = snapshot()
    return snap && snap.rootID === props.sessionID ? snap : null
  })
  const projectView = () => projectSnapshot()

  // The collapsed branch renders the elastic L1 of the persisted
  // `collapsedSummary` source (session or project) with its empty copy.
  // NOTE: these accessors return the VIEW VALUE (like Section's Show-callback
  // accessor), never another accessor — a function-returning-function prop
  // makes OpenTUI/Solid's Show resolve the inner accessor as the `when`
  // value, which renders a field-less view (`0 tokens`).
  const masterSummaryView = () =>
    settings().collapsedSummary === "project" ? projectView() : view()
  const masterSummaryEmpty = () =>
    settings().collapsedSummary === "project" ? "No sessions" : "No usage yet"

  // The Subagents global chevron reads the durable sidebar preference
  // (tokenmeter.sidebar.expanded) through the entry-passed accessor.
  const chevron = () =>
    props.subagentsPref() === "expanded" ? GLYPH.collapse : GLYPH.expand

  // One wheel/touchpad tick = one collapsed agent (2 rows). The ScrollBox
  // wheel path uses scrollAcceleration, not the scrollbar's scrollStep, so a
  // fixed multiplier of 2 is the smallest supported declarative option.
  const subagentsScrollAccel = {
    tick: () => 2,
    reset() {},
  }

  // Header offsets (first row of each agent) and total rows for the current
  // groups/open state — the only row truth besides `agentEntryRows`:
  // viewport height and the toggle reveal both derive from it.
  const subagentsGeometry = () => {
    const snapVal = view()
    const groups = snapVal?.groups ?? []
    const open = openGroupIndex()
    const numbers = settings().numbers
    const starts: number[] = []
    let total = 0
    for (let i = 0; i < groups.length; i++) {
      starts.push(total)
      total += agentEntryRows(i === open, numbers)
    }
    return { starts, total }
  }

  // Single shared layout derivation for viewport height and scroll
  // overflow: `overflow = totalRows > 6`, `height = min(totalRows, 6)`.
  // The single memo is the only row-count truth: both the height binding
  // and the scroll gate read it, preventing a hidden duplicate geometry.
  const subagentsLayout = createMemo(() => {
    const { total } = subagentsGeometry()
    if (total === 0) return { height: 0, overflow: false }
    return {
      height: Math.min(total, SUBAGENTS_VIEWPORT_ROWS),
      overflow: total > SUBAGENTS_VIEWPORT_ROWS,
    }
  })

  // Minimal box handle for the toggle reveal only: the wheel path stays
  // fully declarative (`scrollAcceleration.tick() => 2`), so the ref never
  // intercepts gestures — it only exposes the scroll position for the
  // post-toggle adjustment below.
  let subagentsBox: {
    scrollTop: number
    scrollTo: (position: number) => void
    scrollHeight: number
  } | null = null

  const attachSubagentsBox = (box) => {
    subagentsBox = box ?? null
  }

  // Toggle reveal: opens scroll the MINIMUM distance to show the FULL entry
  // (header + all detail rows — 4 rows compact, 6 precise): no-op while the
  // entry already fits, jump to the entry start when clipped above, advance
  // just enough when the tail overflows below. Collapses only clamp a stale
  // offset back into [0, total - viewport] so no blank rows appear.
  //
  // Timing: Solid effects and click handlers run BEFORE the reconciler
  // commits the new rows on the renderer loop, so an immediate scrollTo
  // clamps to the stale pre-toggle height (the box still reports the old
  // scrollHeight). The effect below therefore only ARMS the reveal keyed by
  // (open index, total rows) — wheel gestures never change that key, so
  // manual scrolling is never yanked back — and the scheduled application
  // waits until the committed scrollHeight matches the expected total
  // (bounded retries), then applies once against fresh bounds.
  let revealKey = ""
  const applyReveal = (
    box: { scrollTop: number; scrollTo: (position: number) => void },
    index: number | null,
    starts: number[],
    total: number,
    viewport: number,
  ) => {
    const max = Math.max(0, total - viewport)
    let top = Math.min(Math.max(0, box.scrollTop), max)
    if (index !== null) {
      const start = starts[index] ?? 0
      const end = start + agentEntryRows(true, settings().numbers)
      if (start < top) top = start
      else if (end > top + viewport) top = end - viewport
    }
    const target = Math.min(Math.max(0, top), max)
    if (target !== box.scrollTop) box.scrollTo(target)
  }
  const scheduleReveal = (
    box: {
      scrollTop: number
      scrollTo: (position: number) => void
      scrollHeight: number
    },
    key: string,
    index: number | null,
    starts: number[],
    total: number,
    viewport: number,
    attempt = 0,
  ) => {
    setTimeout(
      () => {
        // A remount or a newer toggle supersedes this attempt.
        if (subagentsBox !== box || revealKey !== key) return
        if (box.scrollHeight !== total) {
          if (attempt < 8)
            scheduleReveal(
              box,
              key,
              index,
              starts,
              total,
              viewport,
              attempt + 1,
            )
          return
        }
        applyReveal(box, index, starts, total, viewport)
      },
      attempt === 0 ? 0 : 30,
    )
  }
  createEffect(() => {
    const index = openGroupIndex()
    const { starts, total } = subagentsGeometry()
    const viewport = subagentsLayout().height
    const box = subagentsBox
    if (!box || viewport === 0) return
    const key = `${index}:${total}`
    if (key === revealKey) return
    revealKey = key
    scheduleReveal(box, key, index, starts, total, viewport)
  })

  // Index-keyed toggle (pinned shape — the theme-contract hygiene test
  // asserts it): opening one agent closes the other by construction; the
  // reveal effect above runs on the committed post-toggle rows.
  const onToggleGroup = (index: () => number) => () => {
    setOpenGroupIndex(openGroupIndex() === index() ? null : index())
  }

  return (
    <box flexDirection="column">
      <box flexDirection="row">
        {/* biome-ignore lint/a11y/noStaticElementInteractions: OpenTUI text element, not DOM; click-to-toggle is the TUI interaction model. */}
        <text fg={theme().text} selectable={false} onMouseDown={toggleMaster}>
          {`${masterChevron()} `}
        </text>
        {/* biome-ignore lint/a11y/noStaticElementInteractions: OpenTUI text element, not DOM; the master title-text click toggles disclosure (spec: chevron OR title-text). */}
        <text fg={theme().text} selectable={false} onMouseDown={toggleMaster}>
          {truncateToColumns("TokenMeter", inner())}
        </text>
      </box>
      <Show
        when={masterCollapsed()}
        fallback={
          <>
            <Show when={settings().visibility.project}>
              <Section
                title="Project"
                variant="project"
                view={projectView}
                emptyCopy="No sessions"
                open={projectOpen}
                onToggle={() => setSectionOpen("project", !projectOpen())}
                theme={theme}
                inner={inner}
              />
            </Show>
            <Show when={settings().visibility.session}>
              <Section
                title="Session"
                view={view}
                emptyCopy="No usage yet"
                open={sessionOpen}
                onToggle={() => setSectionOpen("session", !sessionOpen())}
                theme={theme}
                inner={inner}
              />
            </Show>
            {/* The Subagents section renders ONLY while the snapshot has at
                least one group: with zero groups there is no heading, no
                scrollbox and no `0 agents · 0 tasks` caption — the section
                consumes zero vertical space and appears automatically once
                the first delegated group exists. Visibility hides the section
                without reserving height; the expanded/collapsed disclosure
                (`tokenmeter.sidebar.expanded`) stays independent. */}
            <Show when={settings().visibility.subagents}>
              <Show when={view()}>
                {(snap) => (
                  <Show when={snap().groups.length > 0}>
                    <box flexDirection="row">
                      {/* biome-ignore lint/a11y/noStaticElementInteractions: OpenTUI text element, not DOM; click-to-toggle is the TUI interaction model. */}
                      <text
                        fg={theme().text}
                        selectable={false}
                        onMouseDown={props.onToggleSubagents}
                      >
                        {`${chevron()} `}
                      </text>
                      {/* biome-ignore lint/a11y/noStaticElementInteractions: OpenTUI text element, not DOM; click-to-toggle is the TUI interaction model. */}
                      <text
                        fg={theme().warning}
                        selectable={false}
                        onMouseDown={props.onToggleSubagents}
                      >
                        Subagents
                      </text>
                      <Show when={props.subagentsPref() === "collapsed"}>
                        {/* biome-ignore lint/a11y/noStaticElementInteractions: OpenTUI text element, not DOM; click-to-toggle is the TUI interaction model. */}
                        <text
                          fg={theme().textMuted}
                          selectable={false}
                          onMouseDown={props.onToggleSubagents}
                        >
                          {` (${formatCount(snap().agents, "agent")} · ${formatCount(snap().delegations, "task")})`}
                        </text>
                      </Show>
                    </box>
                    <Show when={props.subagentsPref() === "expanded"}>
                      <scrollbox
                        width={inner()}
                        height={subagentsLayout().height}
                        scrollY={subagentsLayout().overflow}
                        scrollAcceleration={subagentsScrollAccel}
                        ref={attachSubagentsBox}
                        verticalScrollbarOptions={{
                          visible: subagentsLayout().overflow,
                        }}
                      >
                        <For each={snap().groups}>
                          {(group, index) => (
                            <GroupRows
                              group={group}
                              inner={inner}
                              theme={theme}
                              open={() => openGroupIndex() === index()}
                              onToggle={onToggleGroup(index)}
                            />
                          )}
                        </For>
                      </scrollbox>
                    </Show>
                  </Show>
                )}
              </Show>
            </Show>
          </>
        }
      >
        <SectionSummary
          view={masterSummaryView}
          emptyCopy={masterSummaryEmpty()}
          theme={theme}
          inner={inner}
        />
      </Show>
    </box>
  )
}
