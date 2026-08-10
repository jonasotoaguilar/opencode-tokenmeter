# Feasibility — opencode-plugin

Before designing a plugin, determine whether the user's concept is achievable with available hooks. If not feasible, inform the user clearly and suggest the alternative — never build a workaround silently.

## Feasible as plugins

- Intercepting/blocking tool calls
- Reacting to events (file edits, session completion, etc.)
- Adding custom tools for the LLM
- Modifying LLM parameters (temperature, etc.)
- Custom auth flows for providers
- Customizing session compaction
- Displaying status messages (toasts, inline)

## Feasible TUI plugin work

- Rendering plugin-owned UI through `TuiPlugin`, `api.slots.register`, and supported TUI components.

## NOT feasible as an external plugin (inform user)

- Modifying OpenCode's built-in TUI rendering or core layout
- Adding new built-in tools (requires OC source)
- Changing core agent behavior/prompts
- Intercepting assistant responses mid-stream
- Adding new keybinds or commands
- Modifying internal file read/write
- Adding new permission types

## Alternatives

| Need | Alternative |
| --- | --- |
| OC core changes | Contribute to `packages/opencode` |
| MCP tools | Use MCP server configuration |
| Simple automation | Use shell scripts |
