# Plugin Hooks Reference

> Auto-generated on 2026-08-11T22:04:45.887Z
> Source: `packages/plugin/src/index.ts`

## Plugin Function Signature

```typescript
export type PluginInput = {
  client: ReturnType<typeof createOpencodeClient>
  project: Project
  directory: string
  worktree: string
  experimental_workspace: {
    register(type: string, adapter: WorkspaceAdapter): void
  }
  serverUrl: URL
  $: BunShell
}

export type Plugin = (input: PluginInput) => Promise<Hooks>
```

## Hooks Interface

```typescript
export interface Hooks {
  dispose?: () => Promise<void>
  event?: (input: { event: Event }) => Promise<void>
  config?: (input: Config) => Promise<void>
  tool?: {
    [key: string]: ToolDefinition
  }
  auth?: AuthHook
  provider?: ProviderHook
  /**
   * Called when a new message is received
   */
  "chat.message"?: (
    input: {
      sessionID: string
      agent?: string
      model?: { providerID: string; modelID: string }
      messageID?: string
      variant?: string
    },
    output: { message: UserMessage; parts: Part[] },
  ) => Promise<void>
  /**
   * Modify parameters sent to LLM
   */
  "chat.params"?: (
    input: { sessionID: string; agent: string; model: Model; provider: ProviderContext; message: UserMessage },
    output: {
      temperature: number
      topP: number
      topK: number
      maxOutputTokens: number | undefined
      options: Record<string, any>
    },
  ) => Promise<void>
  "chat.headers"?: (
    input: { sessionID: string; agent: string; model: Model; provider: ProviderContext; message: UserMessage },
    output: { headers: Record<string, string> },
  ) => Promise<void>
  "permission.ask"?: (input: Permission, output: { status: "ask" | "deny" | "allow" }) => Promise<void>
  "command.execute.before"?: (
    input: { command: string; sessionID: string; arguments: string },
    output: { parts: Part[] },
  ) => Promise<void>
  "tool.execute.before"?: (
    input: { tool: string; sessionID: string; callID: string },
    output: { args: any },
  ) => Promise<void>
  "shell.env"?: (
    input: { cwd: string; sessionID?: string; callID?: string },
    output: { env: Record<string, string> },
  ) => Promise<void>
  "tool.execute.after"?: (
    input: { tool: string; sessionID: string; callID: string; args: any },
    output: {
      title: string
      output: string
      metadata: any
    },
  ) => Promise<void>
  "experimental.chat.messages.transform"?: (
    input: {},
    output: {
      messages: {
        info: Message
        parts: Part[]
      }[]
    },
  ) => Promise<void>
  "experimental.chat.system.transform"?: (
    input: { sessionID?: string; model: Model },
    output: {
      system: string[]
    },
  ) => Promise<void>
  "experimental.provider.small_model"?: (input: { provider: ProviderV2 }, output: { model?: ModelV2 }) => Promise<void>
  /**
   * Called before session compaction starts. Allows plugins to customize
   * the compaction prompt.
   *
   * - `context`: Additional context strings appended to the default prompt
   * - `prompt`: If set, replaces the default compaction prompt entirely
   */
  "experimental.session.compacting"?: (
    input: { sessionID: string },
    output: { context: string[]; prompt?: string },
  ) => Promise<void>
  /**
   * Called after compaction succeeds and before a synthetic user
   * auto-continue message is added.
   *
   * - `enabled`: Defaults to `true`. Set to `false` to skip the synthetic
   *   user "continue" turn.
   */
  "experimental.compaction.autocontinue"?: (
    input: {
      sessionID: string
      agent: string
      model: Model
      provider: ProviderContext
      message: UserMessage
      overflow: boolean
    },
    output: { enabled: boolean },
  ) => Promise<void>
  "experimental.text.complete"?: (
    input: { sessionID: string; messageID: string; partID: string },
    output: { text: string },
  ) => Promise<void>
  /**
   * Modify tool definitions (description and parameters) sent to LLM
   */
  "tool.definition"?: (input: { toolID: string }, output: { description: string; parameters: any }) => Promise<void>
}
```

## Hook Categories

### Event Hook
- `event`: Receives all events, use `event.type` to discriminate

### Tool Hook
- `tool`: Register custom tools (see tool-helper.md)

### Chat Hooks
- `chat.message`: Intercept/modify user messages before processing
- `chat.params`: Modify LLM parameters (temperature, topP, topK)

### Permission Hook
- `permission.ask`: Override permission decisions (allow/deny/ask)

### Tool Execution Hooks
- `tool.execute.before`: Intercept before tool runs, modify args
- `tool.execute.after`: Process tool output, modify title/metadata

### Config Hook
- `config`: Modify configuration on load

### Auth Hook
- `auth`: Custom provider authentication (OAuth or API key)

### Experimental Hooks
- `experimental.chat.messages.transform`: Transform message history
- `experimental.chat.system.transform`: Modify system prompt
- `experimental.session.compacting`: Customize compaction context
- `experimental.text.complete`: Post-process text output

## Auth Hook Types

```typescript
export type AuthHook = {
  provider: string
  loader?: (auth: () => Promise<Auth>, provider: Provider) => Promise<Record<string, any>>
  methods: (
    | {
        type: "oauth"
        label: string
        prompts?: Array<
          | {
              type: "text"
              key: string
              message: string
              placeholder?: string
              validate?: (value: string) => string | undefined
              /** @deprecated Use `when` instead */
              condition?: (inputs: Record<string, string>) => boolean
              when?: Rule
            }
          | {
              type: "select"
              key: string
              message: string
              options: Array<{
                label: string
                value: string
                hint?: string
              }>
              /** @deprecated Use `when` instead */
              condition?: (inputs: Record<string, string>) => boolean
              when?: Rule
            }
        >
        authorize(inputs?: Record<string, string>): Promise<AuthOAuthResult>
      }
    | {
        type: "api"
        label: string
        prompts?: Array<
          | {
              type: "text"
              key: string
              message: string
              placeholder?: string
              validate?: (value: string) => string | undefined
              /** @deprecated Use `when` instead */
              condition?: (inputs: Record<string, string>) => boolean
              when?: Rule
            }
          | {
              type: "select"
              key: string
              message: string
              options: Array<{
                label: string
                value: string
                hint?: string
              }>
              /** @deprecated Use `when` instead */
              condition?: (inputs: Record<string, string>) => boolean
              when?: Rule
            }
        >
        authorize?(inputs?: Record<string, string>): Promise<
          | {
              type: "success"
              key: string
              provider?: string
              metadata?: Record<string, string>
            }
          | {
              type: "failed"
            }
        >
      }
  )[]
}


```
