# TUI Slot Surfaces

Slot names are HOST-SURFACE bindings, not generic layout positions. Pick the
slot for the SURFACE you want to extend, never for the widget you want to
draw. The host spec is authoritative for names, props, and render modes; the
installed `TuiHostSlotMap` is authoritative for signatures.

## Decision table

| Desired surface | Slot | Render mode | Notes |
| --- | --- | --- | --- |
| Separate row directly below the native message input | `session_prompt` | replace | Re-render `api.ui.Prompt` faithfully, then add your row below it in a `<box gap={0}>` wrapper. The host renders YOUR component instead of the prompt row, so returning `null` removes the prompt. Session routes only. |
| Bottom row on the Home surface | `home_bottom` | default library mode | Home-only surface; no session props. |
| Horizontal append INSIDE the native prompt/status row | `session_prompt_right` | default | Shares the row with native content. NOT a below-input row. |
| Normal app flow below the active route | `app_bottom` | default | Below the active route's content — NOT attached to the prompt/statusline. Leaves a large flexible gap and renders at the global bottom. |
| Single-winner bottom element | `home_footer` | single_winner | Only one plugin can win the slot; not a general prompt extension. |
| A `statusline` slot | — | — | Does NOT exist in the public host API (verified 1.18.x). Never register an unsupported slot name. |

## Required pre-step before choosing a placement

1. Read the host slot spec — the authoritative local copy is
   `<opencode-checkout>/packages/opencode/specs/tui-plugins.md` (team checkout:
   `/home/jona/repos/opencode/packages/opencode/specs/tui-plugins.md`), "Slots"
   section. It states e.g. that `app_bottom` "is rendered in normal layout
   flow below the active route".
2. Read at least one reference plugin that renders your chosen surface:
   `slkiser/opencode-quota` `src/tui.tsx` shows `session_prompt`
   (`SessionPromptWithCompactStatus`), `home_bottom` (`HomeBottomView`), and a
   single `api.slots.register` covering both.
3. Classify the desired surface in one sentence BEFORE writing the
   registration. If the classification contradicts the slot, change the slot,
   never the classification.

## `session_prompt` (replace) — the below-input pattern

Props (installed `@opencode-ai/plugin` 1.18.x, `TuiHostSlotMap`):

```typescript
{ session_id: string; visible?: boolean; disabled?: boolean;
  on_submit?: () => void; ref?: (ref: TuiPromptRef | undefined) => void }
```

Pattern (from opencode-quota `SessionPromptWithCompactStatus`):

```tsx
<box gap={0}>
  <props.api.ui.Prompt
    sessionID={props.sessionID}
    visible={props.visible}
    disabled={props.disabled}
    onSubmit={props.onSubmit}
    ref={props.promptRef}
  />
  {/* your row, e.g. right-aligned muted text: */}
  <box flexDirection="row" justifyContent="flex-end">
    <text fg={props.api.theme.current.textMuted} wrapMode="none">
      {line()}
    </text>
  </box>
</box>
```

### Prop-forwarding checklist

- [ ] `sessionID={props.session_id}` — the passed current session, never a guessed route
- [ ] `visible={props.visible}`
- [ ] `disabled={props.disabled}`
- [ ] `onSubmit={props.on_submit}`
- [ ] `ref={props.ref}`
- [ ] Native `api.ui.Prompt` re-rendered unconditionally (returning `null` removes the prompt)
- [ ] Extra row below the prompt inside `<box gap={0}>` (zero gap, vertical)
- [ ] Line styled natively: `fg={api.theme.current.textMuted}`, `wrapMode="none"`, no invented background/font/margin

### Semantics

- The slot fires only on session routes; there is no session on Home. Do not
  synthesize a Home metric here — use `home_bottom` only when a Home surface
  is meaningful for the feature, and document an intentionally empty Home
  otherwise.
- `api.ui.Prompt` also accepts `hint` and `right` JSX elements for content
  INSIDE the prompt row; prefer those for in-row content and reserve
  `session_prompt` for a separate row below the input.

## Compatibility verification

- Installed types are authoritative for signatures:
  `node_modules/@opencode-ai/plugin/dist/tui.d.ts` — `TuiHostSlotMap` (slot
  names + props) and `TuiPromptProps` (`api.ui.Prompt`).
- The host spec is authoritative for behavior: `packages/opencode/specs/tui-plugins.md`
  in an opencode checkout (render modes per slot, layout flow).
- Current render modes: `replace` — `home_logo`, `home_prompt`, `session_prompt`;
  `single_winner` — `home_footer`, `sidebar_title`, `sidebar_footer`; default
  library mode — `app`, `app_bottom`, `home_prompt_right`,
  `session_prompt_right`, `home_bottom`, `sidebar_content`.
