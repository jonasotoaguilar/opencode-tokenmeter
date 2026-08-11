# Tool Helper Reference

> Auto-generated on 2026-08-11T22:04:45.887Z
> Source: `packages/plugin/src/tool.ts`

## Tool Definition

```typescript
import { z } from "zod"

export type ToolContext = {
  sessionID: string
  messageID: string
  agent: string
  /**
   * Current project directory for this session.
   * Prefer this over process.cwd() when resolving relative paths.
   */
  directory: string
  /**
   * Project worktree root for this session.
   * Useful for generating stable relative paths (e.g. path.relative(worktree, absPath)).
   */
  worktree: string
  abort: AbortSignal
  metadata(input: { title?: string; metadata?: { [key: string]: any } }): void
  ask(input: AskInput): Promise<void>
}

type AskInput = {
  permission: string
  patterns: string[]
  always: string[]
  metadata: { [key: string]: any }
}

export type ToolAttachment = {
  type: "file"
  mime: string
  url: string
  filename?: string
}

export type ToolResult =
  | string
  | {
      title?: string
      output: string
      metadata?: { [key: string]: any }
      attachments?: ToolAttachment[]
    }

export function tool<Args extends z.ZodRawShape>(input: {
  description: string
  args: Args
  execute(args: z.infer<z.ZodObject<Args>>, context: ToolContext): Promise<ToolResult>
}) {
  return input
}
tool.schema = z

export type ToolDefinition = ReturnType<typeof tool>

```

## Usage Pattern

```typescript
import { type Plugin, tool } from "@opencode-ai/plugin"

export const MyPlugin: Plugin = async (ctx) => {
  return {
    tool: {
      myTool: tool({
        description: "What this tool does",
        args: {
          input: tool.schema.string().describe("Input parameter"),
          count: tool.schema.number().optional().describe("Optional count"),
          enabled: tool.schema.boolean().default(true),
        },
        async execute(args, context) {
          // args is typed from schema
          // context: { sessionID, messageID, agent, abort }
          return `Result: ${args.input}`
        },
      }),
    },
  }
}
```

## Zod Schema Methods

`tool.schema` is Zod. Common methods:

| Method | Description |
|--------|-------------|
| `.string()` | String argument |
| `.number()` | Number argument |
| `.boolean()` | Boolean argument |
| `.array(schema)` | Array of items |
| `.object({ ... })` | Nested object |
| `.enum(["a", "b"])` | Enum values |
| `.optional()` | Make optional |
| `.default(val)` | Default value |
| `.describe("...")` | Add description for LLM |

## Tool Context

```typescript
type ToolContext = {
  sessionID: string
  messageID: string
  agent: string
  abort: AbortSignal
}
```
