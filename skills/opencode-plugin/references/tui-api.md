# TUI Plugin API Reference

> Verified against `@opencode-ai/plugin/dist/tui.d.ts` and
> `@opencode-ai/sdk/dist/v2/gen/sdk.gen.d.ts` (OpenCode 1.18.x). The API can
> drift between versions: before relying on a client method, verify its
> signature in the INSTALLED packages (`node_modules/@opencode-ai/plugin/dist/tui.d.ts`
> and `node_modules/@opencode-ai/sdk/dist/v2/gen/sdk.gen.d.ts`) — never guess
> a method path from documentation alone.

## Plugin signature and API object

```typescript
export type TuiPlugin = (
  api: TuiPluginApi,
  options: PluginOptions | undefined,
  meta: TuiPluginMeta,
) => Promise<void>
```

`TuiPluginApi` exposes (subset used by sidebars):

| Field | Shape | Notes |
|---|---|---|
| `kv` | `{ get<V>(key, fallback?): V; set(key, value): void; readonly ready: boolean }` | Persistent plugin storage. `ready` may be false during startup — a write then may be dropped. |
| `state` | `TuiState` | Synchronized host state; see below. |
| `client` | `OpencodeClient` | The generated SDK client (REST). |
| `event` | `TuiEventBus` | `on(type, handler)` returns a disposer. |
| `route` | `{ readonly current: { name, params } }` | Reactive session/route signal; read inside a Solid effect to track session changes. |
| `slots` | `{ register({ order, slots }) }` | `sidebar_content(ctx, props)` renders plugin UI; `ctx.theme.current` and `props.session_id` carry host context. |
| `lifecycle` | `{ onDispose(fn) }` | Cleanup registration. |
| `theme` | `{ current }` | Host theme object (semantic tokens). |

## TuiState

```typescript
type TuiState = {
  readonly ready: boolean
  readonly config: SdkConfig
  readonly provider: ReadonlyArray<Provider>
  readonly path: { state: string; config: string; worktree: string; directory: string }
  readonly vcs: { branch?: string; default_branch?: string } | undefined
  session: {
    count: () => number
    get: (sessionID: string) => Session | undefined
    diff: (sessionID: string) => ReadonlyArray<TuiSidebarFileItem>
    todo: (sessionID: string) => ReadonlyArray<TuiSidebarTodoItem>
    messages: (sessionID: string) => ReadonlyArray<Message>
    status: (sessionID: string) => SessionStatus | undefined
    permission: (sessionID: string) => ReadonlyArray<PermissionRequest>
    question: (sessionID: string) => ReadonlyArray<QuestionRequest>
  }
  part: (messageID: string) => ReadonlyArray<Part>
  lsp: () => ReadonlyArray<TuiSidebarLspItem>
  mcp: () => ReadonlyArray<TuiSidebarMcpItem>
}
```

## Client methods used by TUI plugins

Both `project.current` and `session.list` accept **optional `directory` and
`workspace` query parameters**. Pass the active directory from
`api.state.path.directory`; the implicit server context is NOT a reliable
binding — after destructive operations (e.g. `session.deleted`) the server may
fail to resolve the current project without an explicit directory.

```typescript
// GET /project/current
client.project.current(parameters?: {
  directory?: string
  workspace?: string
}): Promise<{ data?: { id: string; worktree?: string } }>

// GET /session
client.session.list(parameters?: {
  directory?: string
  workspace?: string
  scope?: "project"      // filter to the current project across worktrees
  path?: string
  roots?: boolean        // true = root sessions only; omit to keep children
  start?: number
  search?: string
  limit?: number
}): Promise<{ data?: Session[] }>
```

### Rules learned from runtime failures

- There is **no `api.client.experimental.session.list`**. `experimental.*`
  names exist only as plugin HOOK names (`experimental.session.compacting`,
  etc.) — never as client method paths.
- `session.list({ scope: "project" })` still returns sessions across ALL
  directories/worktrees of the project; `roots` is the flag that drops
  child/delegated sessions, so omit it to keep them.
- `api.state.session.messages(sessionID)` is a synchronous in-memory mirror;
  the authoritative source is `client.session.messages({ sessionID })`.
- A missing list payload (`{ data: undefined }`) is an error, never a silent
  empty list: showing zeroed metrics while the API is down is a data bug.
- Session events (`session.deleted`, etc.) carry `properties.info` as the full
  `Session` object — including `projectID` — which is the reliable way to know
  which project an operation touched.
