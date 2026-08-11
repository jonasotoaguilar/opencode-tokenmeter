# Events Reference

> Auto-generated on 2026-08-11T22:04:45.887Z
> Source: `packages/sdk/js/src/v2/gen/types.gen.ts`

## Event Union (89 types)

```typescript
export type Event =
  | EventModelsDevRefreshed
  | EventIntegrationUpdated
  | EventIntegrationConnectionUpdated
  | EventCatalogUpdated
  | EventSessionCreated
  | EventSessionUpdated
  | EventSessionDeleted
  | EventMessageUpdated
  | EventMessageRemoved
  | EventMessagePartUpdated
  | EventMessagePartRemoved
  | EventSessionNextAgentSwitched
  | EventSessionNextModelSwitched
  | EventSessionNextMoved
  | EventSessionNextPrompted
  | EventSessionNextPromptAdmitted
  | EventSessionNextContextUpdated
  | EventSessionNextSynthetic
  | EventSessionNextShellStarted
  | EventSessionNextShellEnded
  | EventSessionNextStepStarted
  | EventSessionNextStepEnded
  | EventSessionNextStepFailed
  | EventSessionNextTextStarted
  | EventSessionNextTextDelta
  | EventSessionNextTextEnded
  | EventSessionNextReasoningStarted
  | EventSessionNextReasoningDelta
  | EventSessionNextReasoningEnded
  | EventSessionNextToolInputStarted
  | EventSessionNextToolInputDelta
  | EventSessionNextToolInputEnded
  | EventSessionNextToolCalled
  | EventSessionNextToolProgress
  | EventSessionNextToolSuccess
  | EventSessionNextToolFailed
  | EventSessionNextRetried
  | EventSessionNextCompactionStarted
  | EventSessionNextCompactionDelta
  | EventSessionNextCompactionEnded
  | EventSessionNextRevertStaged
  | EventSessionNextRevertCleared
  | EventSessionNextRevertCommitted
  | EventMessagePartDelta
  | EventSessionDiff
  | EventSessionError
  | EventInstallationUpdated
  | EventInstallationUpdateAvailable
  | EventFileEdited
  | EventReferenceUpdated
  | EventPermissionV2Asked
  | EventPermissionV2Replied
  | EventPluginAdded
  | EventProjectDirectoriesUpdated
  | EventFileWatcherUpdated
  | EventPtyCreated
  | EventPtyUpdated
  | EventPtyExited
  | EventPtyDeleted
  | EventQuestionV2Asked
  | EventQuestionV2Replied
  | EventQuestionV2Rejected
  | EventTodoUpdated
  | EventLspUpdated
  | EventPermissionAsked
  | EventPermissionReplied
  | EventTuiPromptAppend2
  | EventTuiCommandExecute2
  | EventTuiToastShow2
  | EventTuiSessionSelect2
  | EventMcpToolsChanged
  | EventMcpBrowserOpenFailed
  | EventCommandExecuted
  | EventProjectUpdated
  | EventSessionStatus
  | EventSessionIdle
  | EventQuestionAsked
  | EventQuestionReplied
  | EventQuestionRejected
  | EventSessionCompacted
  | EventVcsBranchUpdated
  | EventWorkspaceReady
  | EventWorkspaceFailed
  | EventWorkspaceStatus
  | EventWorktreeReady
  | EventWorktreeFailed
  | EventServerConnected
  | EventGlobalDisposed
  | EventServerInstanceDisposed
```

## Quick Reference

| Event Type | TypeScript Type |
|------------|-----------------|
| `models-dev.refreshed` | `EventModelsDevRefreshed` |
| `integration.updated` | `EventIntegrationUpdated` |
| `integration.connection.updated` | `EventIntegrationConnectionUpdated` |
| `catalog.updated` | `EventCatalogUpdated` |
| `session.created` | `EventSessionCreated` |
| `session.updated` | `EventSessionUpdated` |
| `session.deleted` | `EventSessionDeleted` |
| `message.updated` | `EventMessageUpdated` |
| `message.removed` | `EventMessageRemoved` |
| `message.part.updated` | `EventMessagePartUpdated` |
| `message.part.removed` | `EventMessagePartRemoved` |
| `session.next.agent.switched` | `EventSessionNextAgentSwitched` |
| `session.next.model.switched` | `EventSessionNextModelSwitched` |
| `session.next.moved` | `EventSessionNextMoved` |
| `session.next.prompted` | `EventSessionNextPrompted` |
| `session.next.prompt.admitted` | `EventSessionNextPromptAdmitted` |
| `session.next.context.updated` | `EventSessionNextContextUpdated` |
| `session.next.synthetic` | `EventSessionNextSynthetic` |
| `session.next.shell.started` | `EventSessionNextShellStarted` |
| `session.next.shell.ended` | `EventSessionNextShellEnded` |
| `session.next.step.started` | `EventSessionNextStepStarted` |
| `session.next.step.ended` | `EventSessionNextStepEnded` |
| `session.next.step.failed` | `EventSessionNextStepFailed` |
| `session.next.text.started` | `EventSessionNextTextStarted` |
| `session.next.text.delta` | `EventSessionNextTextDelta` |
| `session.next.text.ended` | `EventSessionNextTextEnded` |
| `session.next.reasoning.started` | `EventSessionNextReasoningStarted` |
| `session.next.reasoning.delta` | `EventSessionNextReasoningDelta` |
| `session.next.reasoning.ended` | `EventSessionNextReasoningEnded` |
| `session.next.tool.input.started` | `EventSessionNextToolInputStarted` |
| `session.next.tool.input.delta` | `EventSessionNextToolInputDelta` |
| `session.next.tool.input.ended` | `EventSessionNextToolInputEnded` |
| `session.next.tool.called` | `EventSessionNextToolCalled` |
| `session.next.tool.progress` | `EventSessionNextToolProgress` |
| `session.next.tool.success` | `EventSessionNextToolSuccess` |
| `session.next.tool.failed` | `EventSessionNextToolFailed` |
| `session.next.retried` | `EventSessionNextRetried` |
| `session.next.compaction.started` | `EventSessionNextCompactionStarted` |
| `session.next.compaction.delta` | `EventSessionNextCompactionDelta` |
| `session.next.compaction.ended` | `EventSessionNextCompactionEnded` |
| `session.next.revert.staged` | `EventSessionNextRevertStaged` |
| `session.next.revert.cleared` | `EventSessionNextRevertCleared` |
| `session.next.revert.committed` | `EventSessionNextRevertCommitted` |
| `message.part.delta` | `EventMessagePartDelta` |
| `session.diff` | `EventSessionDiff` |
| `session.error` | `EventSessionError` |
| `installation.updated` | `EventInstallationUpdated` |
| `installation.update-available` | `EventInstallationUpdateAvailable` |
| `file.edited` | `EventFileEdited` |
| `reference.updated` | `EventReferenceUpdated` |
| `permission.v2.asked` | `EventPermissionV2Asked` |
| `permission.v2.replied` | `EventPermissionV2Replied` |
| `plugin.added` | `EventPluginAdded` |
| `project.directories.updated` | `EventProjectDirectoriesUpdated` |
| `file.watcher.updated` | `EventFileWatcherUpdated` |
| `pty.created` | `EventPtyCreated` |
| `pty.updated` | `EventPtyUpdated` |
| `pty.exited` | `EventPtyExited` |
| `pty.deleted` | `EventPtyDeleted` |
| `question.v2.asked` | `EventQuestionV2Asked` |
| `question.v2.replied` | `EventQuestionV2Replied` |
| `question.v2.rejected` | `EventQuestionV2Rejected` |
| `todo.updated` | `EventTodoUpdated` |
| `lsp.updated` | `EventLspUpdated` |
| `permission.asked` | `EventPermissionAsked` |
| `permission.replied` | `EventPermissionReplied` |
| `tui.prompt.append` | `EventTuiPromptAppend2` |
| `tui.command.execute` | `EventTuiCommandExecute2` |
| `tui.toast.show` | `EventTuiToastShow2` |
| `tui.session.select` | `EventTuiSessionSelect2` |
| `mcp.tools.changed` | `EventMcpToolsChanged` |
| `mcp.browser.open.failed` | `EventMcpBrowserOpenFailed` |
| `command.executed` | `EventCommandExecuted` |
| `project.updated` | `EventProjectUpdated` |
| `session.status` | `EventSessionStatus` |
| `session.idle` | `EventSessionIdle` |
| `question.asked` | `EventQuestionAsked` |
| `question.replied` | `EventQuestionReplied` |
| `question.rejected` | `EventQuestionRejected` |
| `session.compacted` | `EventSessionCompacted` |
| `vcs.branch.updated` | `EventVcsBranchUpdated` |
| `workspace.ready` | `EventWorkspaceReady` |
| `workspace.failed` | `EventWorkspaceFailed` |
| `workspace.status` | `EventWorkspaceStatus` |
| `worktree.ready` | `EventWorktreeReady` |
| `worktree.failed` | `EventWorktreeFailed` |
| `server.connected` | `EventServerConnected` |
| `global.disposed` | `EventGlobalDisposed` |
| `server.instance.disposed` | `EventServerInstanceDisposed` |

## Events by Category

### catalog

#### `catalog.updated`

```typescript
export type EventCatalogUpdated = {
  id: string
  type: "catalog.updated"
  properties: {
    [key: string]: unknown
  }
}
```

### command

#### `command.executed`

```typescript
export type EventCommandExecuted = {
  id: string
  type: "command.executed"
  properties: {
    name: string
    sessionID: string
    arguments: string
    messageID: string
  }
}
```

### file

#### `file.edited`

```typescript
export type EventFileEdited = {
  id: string
  type: "file.edited"
  properties: {
    file: string
  }
}
```

#### `file.watcher.updated`

```typescript
export type EventFileWatcherUpdated = {
  id: string
  type: "file.watcher.updated"
  properties: {
    file: string
    event: "add" | "change" | "unlink"
  }
}
```

### global

#### `global.disposed`

```typescript
export type EventGlobalDisposed = {
  id: string
  type: "global.disposed"
  properties: {
    [key: string]: unknown
  }
}
```

### installation

#### `installation.updated`

```typescript
export type EventInstallationUpdated = {
  id: string
  type: "installation.updated"
  properties: {
    version: string
  }
}
```

#### `installation.update-available`

```typescript
export type EventInstallationUpdateAvailable = {
  id: string
  type: "installation.update-available"
  properties: {
    version: string
  }
}
```

### integration

#### `integration.updated`

```typescript
export type EventIntegrationUpdated = {
  id: string
  type: "integration.updated"
  properties: {
    [key: string]: unknown
  }
}
```

#### `integration.connection.updated`

```typescript
export type EventIntegrationConnectionUpdated = {
  id: string
  type: "integration.connection.updated"
  properties: {
    integrationID: string
  }
}
```

### lsp

#### `lsp.updated`

```typescript
export type EventLspUpdated = {
  id: string
  type: "lsp.updated"
  properties: {
    [key: string]: unknown
  }
}
```

### mcp

#### `mcp.tools.changed`

```typescript
export type EventMcpToolsChanged = {
  id: string
  type: "mcp.tools.changed"
  properties: {
    server: string
  }
}
```

#### `mcp.browser.open.failed`

```typescript
export type EventMcpBrowserOpenFailed = {
  id: string
  type: "mcp.browser.open.failed"
  properties: {
    mcpName: string
    url: string
  }
}
```

### message

#### `message.updated`

```typescript
export type EventMessageUpdated = {
  id: string
  type: "message.updated"
  properties: {
    sessionID: string
    info: Message
  }
}
```

#### `message.removed`

```typescript
export type EventMessageRemoved = {
  id: string
  type: "message.removed"
  properties: {
    sessionID: string
    messageID: string
  }
}
```

#### `message.part.updated`

```typescript
export type EventMessagePartUpdated = {
  id: string
  type: "message.part.updated"
  properties: {
    sessionID: string
    part: Part
    time: number
  }
}
```

#### `message.part.removed`

```typescript
export type EventMessagePartRemoved = {
  id: string
  type: "message.part.removed"
  properties: {
    sessionID: string
    messageID: string
    partID: string
  }
}
```

#### `message.part.delta`

```typescript
export type EventMessagePartDelta = {
  id: string
  type: "message.part.delta"
  properties: {
    sessionID: string
    messageID: string
    partID: string
    field: string
    delta: string
  }
}
```

### models-dev

#### `models-dev.refreshed`

```typescript
export type EventModelsDevRefreshed = {
  id: string
  type: "models-dev.refreshed"
  properties: {
    [key: string]: unknown
  }
}
```

### permission

#### `permission.v2.asked`

```typescript
export type EventPermissionV2Asked = {
  id: string
  type: "permission.v2.asked"
  properties: {
    id: string
    sessionID: string
    action: string
    resources: Array<string>
    save?: Array<string>
    metadata?: {
      [key: string]: unknown
    }
    source?: PermissionV2Source
  }
}
```

#### `permission.v2.replied`

```typescript
export type EventPermissionV2Replied = {
  id: string
  type: "permission.v2.replied"
  properties: {
    sessionID: string
    requestID: string
    reply: PermissionV2Reply
  }
}
```

#### `permission.asked`

```typescript
export type EventPermissionAsked = {
  id: string
  type: "permission.asked"
  properties: {
    id: string
    sessionID: string
    permission: string
    patterns: Array<string>
    metadata: {
      [key: string]: unknown
    }
    always: Array<string>
    tool?: {
      messageID: string
      callID: string
    }
  }
}
```

#### `permission.replied`

```typescript
export type EventPermissionReplied = {
  id: string
  type: "permission.replied"
  properties: {
    sessionID: string
    requestID: string
    reply: "once" | "always" | "reject"
  }
}
```

### plugin

#### `plugin.added`

```typescript
export type EventPluginAdded = {
  id: string
  type: "plugin.added"
  properties: {
    id: string
  }
}
```

### project

#### `project.directories.updated`

```typescript
export type EventProjectDirectoriesUpdated = {
  id: string
  type: "project.directories.updated"
  properties: {
    projectID: string
  }
}
```

#### `project.updated`

```typescript
export type EventProjectUpdated = {
  id: string
  type: "project.updated"
  properties: {
    id: string
    worktree: string
    vcs?: ProjectVcs
    name?: string
    icon?: ProjectIcon
    commands?: ProjectCommands
    time: ProjectTime
    sandboxes: Array<string>
  }
}
```

### pty

#### `pty.created`

```typescript
export type EventPtyCreated = {
  id: string
  type: "pty.created"
  properties: {
    info: Pty
  }
}
```

#### `pty.updated`

```typescript
export type EventPtyUpdated = {
  id: string
  type: "pty.updated"
  properties: {
    info: Pty
  }
}
```

#### `pty.exited`

```typescript
export type EventPtyExited = {
  id: string
  type: "pty.exited"
  properties: {
    id: string
    exitCode: number
  }
}
```

#### `pty.deleted`

```typescript
export type EventPtyDeleted = {
  id: string
  type: "pty.deleted"
  properties: {
    id: string
  }
}
```

### question

#### `question.v2.asked`

```typescript
export type EventQuestionV2Asked = {
  id: string
  type: "question.v2.asked"
  properties: {
    id: string
    sessionID: string
    /**
     * Questions to ask
     */
    questions: Array<QuestionV2Info>
    tool?: QuestionV2Tool
  }
}
```

#### `question.v2.replied`

```typescript
export type EventQuestionV2Replied = {
  id: string
  type: "question.v2.replied"
  properties: {
    sessionID: string
    requestID: string
    answers: Array<QuestionV2Answer>
  }
}
```

#### `question.v2.rejected`

```typescript
export type EventQuestionV2Rejected = {
  id: string
  type: "question.v2.rejected"
  properties: {
    sessionID: string
    requestID: string
  }
}
```

#### `question.asked`

```typescript
export type EventQuestionAsked = {
  id: string
  type: "question.asked"
  properties: {
    id: string
    sessionID: string
    /**
     * Questions to ask
     */
    questions: Array<QuestionInfo>
    tool?: QuestionTool
  }
}
```

#### `question.replied`

```typescript
export type EventQuestionReplied = {
  id: string
  type: "question.replied"
  properties: {
    sessionID: string
    requestID: string
    answers: Array<QuestionAnswer>
  }
}
```

#### `question.rejected`

```typescript
export type EventQuestionRejected = {
  id: string
  type: "question.rejected"
  properties: {
    sessionID: string
    requestID: string
  }
}
```

### reference

#### `reference.updated`

```typescript
export type EventReferenceUpdated = {
  id: string
  type: "reference.updated"
  properties: {
    [key: string]: unknown
  }
}
```

### server

#### `server.connected`

```typescript
export type EventServerConnected = {
  id: string
  type: "server.connected"
  properties: {
    [key: string]: unknown
  }
}
```

#### `server.instance.disposed`

```typescript
export type EventServerInstanceDisposed = {
  id: string
  type: "server.instance.disposed"
  properties: {
    directory: string
  }
}
```

### session

#### `session.created`

```typescript
export type EventSessionCreated = {
  id: string
  type: "session.created"
  properties: {
    sessionID: string
    info: Session
  }
}
```

#### `session.updated`

```typescript
export type EventSessionUpdated = {
  id: string
  type: "session.updated"
  properties: {
    sessionID: string
    info: Session
  }
}
```

#### `session.deleted`

```typescript
export type EventSessionDeleted = {
  id: string
  type: "session.deleted"
  properties: {
    sessionID: string
    info: Session
  }
}
```

#### `session.next.agent.switched`

```typescript
export type EventSessionNextAgentSwitched = {
  id: string
  type: "session.next.agent.switched"
  properties: {
    timestamp: number
    sessionID: string
    messageID: string
    agent: string
  }
}
```

#### `session.next.model.switched`

```typescript
export type EventSessionNextModelSwitched = {
  id: string
  type: "session.next.model.switched"
  properties: {
    timestamp: number
    sessionID: string
    messageID: string
    model: ModelRef
  }
}
```

#### `session.next.moved`

```typescript
export type EventSessionNextMoved = {
  id: string
  type: "session.next.moved"
  properties: {
    timestamp: number
    sessionID: string
    location: LocationRef
    subdirectory?: string
  }
}
```

#### `session.next.prompted`

```typescript
export type EventSessionNextPrompted = {
  id: string
  type: "session.next.prompted"
  properties: {
    timestamp: number
    sessionID: string
    messageID: string
    prompt: Prompt
    delivery: "steer" | "queue"
  }
}
```

#### `session.next.prompt.admitted`

```typescript
export type EventSessionNextPromptAdmitted = {
  id: string
  type: "session.next.prompt.admitted"
  properties: {
    timestamp: number
    sessionID: string
    messageID: string
    prompt: Prompt
    delivery: "steer" | "queue"
  }
}
```

#### `session.next.context.updated`

```typescript
export type EventSessionNextContextUpdated = {
  id: string
  type: "session.next.context.updated"
  properties: {
    timestamp: number
    sessionID: string
    messageID: string
    text: string
  }
}
```

#### `session.next.synthetic`

```typescript
export type EventSessionNextSynthetic = {
  id: string
  type: "session.next.synthetic"
  properties: {
    timestamp: number
    sessionID: string
    messageID: string
    text: string
  }
}
```

#### `session.next.shell.started`

```typescript
export type EventSessionNextShellStarted = {
  id: string
  type: "session.next.shell.started"
  properties: {
    timestamp: number
    sessionID: string
    messageID: string
    callID: string
    command: string
  }
}
```

#### `session.next.shell.ended`

```typescript
export type EventSessionNextShellEnded = {
  id: string
  type: "session.next.shell.ended"
  properties: {
    timestamp: number
    sessionID: string
    callID: string
    output: string
  }
}
```

#### `session.next.step.started`

```typescript
export type EventSessionNextStepStarted = {
  id: string
  type: "session.next.step.started"
  properties: {
    timestamp: number
    sessionID: string
    assistantMessageID: string
    agent: string
    model: ModelRef
    snapshot?: string
  }
}
```

#### `session.next.step.ended`

```typescript
export type EventSessionNextStepEnded = {
  id: string
  type: "session.next.step.ended"
  properties: {
    timestamp: number
    sessionID: string
    assistantMessageID: string
    finish: string
    cost: number
    tokens: {
      input: number
      output: number
      reasoning: number
      cache: {
        read: number
        write: number
      }
    }
    snapshot?: string
    files?: Array<string>
  }
}
```

#### `session.next.step.failed`

```typescript
export type EventSessionNextStepFailed = {
  id: string
  type: "session.next.step.failed"
  properties: {
    timestamp: number
    sessionID: string
    assistantMessageID: string
    error: SessionErrorUnknown
  }
}
```

#### `session.next.text.started`

```typescript
export type EventSessionNextTextStarted = {
  id: string
  type: "session.next.text.started"
  properties: {
    timestamp: number
    sessionID: string
    assistantMessageID: string
    textID: string
  }
}
```

#### `session.next.text.delta`

```typescript
export type EventSessionNextTextDelta = {
  id: string
  type: "session.next.text.delta"
  properties: {
    timestamp: number
    sessionID: string
    assistantMessageID: string
    textID: string
    delta: string
  }
}
```

#### `session.next.text.ended`

```typescript
export type EventSessionNextTextEnded = {
  id: string
  type: "session.next.text.ended"
  properties: {
    timestamp: number
    sessionID: string
    assistantMessageID: string
    textID: string
    text: string
  }
}
```

#### `session.next.reasoning.started`

```typescript
export type EventSessionNextReasoningStarted = {
  id: string
  type: "session.next.reasoning.started"
  properties: {
    timestamp: number
    sessionID: string
    assistantMessageID: string
    reasoningID: string
    providerMetadata?: LlmProviderMetadata
  }
}
```

#### `session.next.reasoning.delta`

```typescript
export type EventSessionNextReasoningDelta = {
  id: string
  type: "session.next.reasoning.delta"
  properties: {
    timestamp: number
    sessionID: string
    assistantMessageID: string
    reasoningID: string
    delta: string
  }
}
```

#### `session.next.reasoning.ended`

```typescript
export type EventSessionNextReasoningEnded = {
  id: string
  type: "session.next.reasoning.ended"
  properties: {
    timestamp: number
    sessionID: string
    assistantMessageID: string
    reasoningID: string
    text: string
    providerMetadata?: LlmProviderMetadata
  }
}
```

#### `session.next.tool.input.started`

```typescript
export type EventSessionNextToolInputStarted = {
  id: string
  type: "session.next.tool.input.started"
  properties: {
    timestamp: number
    sessionID: string
    assistantMessageID: string
    callID: string
    name: string
  }
}
```

#### `session.next.tool.input.delta`

```typescript
export type EventSessionNextToolInputDelta = {
  id: string
  type: "session.next.tool.input.delta"
  properties: {
    timestamp: number
    sessionID: string
    assistantMessageID: string
    callID: string
    delta: string
  }
}
```

#### `session.next.tool.input.ended`

```typescript
export type EventSessionNextToolInputEnded = {
  id: string
  type: "session.next.tool.input.ended"
  properties: {
    timestamp: number
    sessionID: string
    assistantMessageID: string
    callID: string
    text: string
  }
}
```

#### `session.next.tool.called`

```typescript
export type EventSessionNextToolCalled = {
  id: string
  type: "session.next.tool.called"
  properties: {
    timestamp: number
    sessionID: string
    assistantMessageID: string
    callID: string
    tool: string
    input: {
      [key: string]: unknown
    }
    provider: {
      executed: boolean
      metadata?: LlmProviderMetadata
    }
  }
}
```

#### `session.next.tool.progress`

```typescript
export type EventSessionNextToolProgress = {
  id: string
  type: "session.next.tool.progress"
  properties: {
    timestamp: number
    sessionID: string
    assistantMessageID: string
    callID: string
    structured: {
      [key: string]: unknown
    }
    content: Array<LlmToolContent>
  }
}
```

#### `session.next.tool.success`

```typescript
export type EventSessionNextToolSuccess = {
  id: string
  type: "session.next.tool.success"
  properties: {
    timestamp: number
    sessionID: string
    assistantMessageID: string
    callID: string
    structured: {
      [key: string]: unknown
    }
    content: Array<LlmToolContent>
    outputPaths?: Array<string>
    result?: unknown
    provider: {
      executed: boolean
      metadata?: LlmProviderMetadata
    }
  }
}
```

#### `session.next.tool.failed`

```typescript
export type EventSessionNextToolFailed = {
  id: string
  type: "session.next.tool.failed"
  properties: {
    timestamp: number
    sessionID: string
    assistantMessageID: string
    callID: string
    error: SessionErrorUnknown
    result?: unknown
    provider: {
      executed: boolean
      metadata?: LlmProviderMetadata
    }
  }
}
```

#### `session.next.retried`

```typescript
export type EventSessionNextRetried = {
  id: string
  type: "session.next.retried"
  properties: {
    timestamp: number
    sessionID: string
    attempt: number
    error: SessionNextRetryError
  }
}
```

#### `session.next.compaction.started`

```typescript
export type EventSessionNextCompactionStarted = {
  id: string
  type: "session.next.compaction.started"
  properties: {
    timestamp: number
    sessionID: string
    messageID: string
    reason: "auto" | "manual"
  }
}
```

#### `session.next.compaction.delta`

```typescript
export type EventSessionNextCompactionDelta = {
  id: string
  type: "session.next.compaction.delta"
  properties: {
    timestamp: number
    sessionID: string
    messageID: string
    text: string
  }
}
```

#### `session.next.compaction.ended`

```typescript
export type EventSessionNextCompactionEnded = {
  id: string
  type: "session.next.compaction.ended"
  properties: {
    timestamp: number
    sessionID: string
    messageID: string
    reason: "auto" | "manual"
    text: string
    recent: string
  }
}
```

#### `session.next.revert.staged`

```typescript
export type EventSessionNextRevertStaged = {
  id: string
  type: "session.next.revert.staged"
  properties: {
    timestamp: number
    sessionID: string
    revert: RevertState
  }
}
```

#### `session.next.revert.cleared`

```typescript
export type EventSessionNextRevertCleared = {
  id: string
  type: "session.next.revert.cleared"
  properties: {
    timestamp: number
    sessionID: string
  }
}
```

#### `session.next.revert.committed`

```typescript
export type EventSessionNextRevertCommitted = {
  id: string
  type: "session.next.revert.committed"
  properties: {
    timestamp: number
    sessionID: string
    messageID: string
  }
}
```

#### `session.diff`

```typescript
export type EventSessionDiff = {
  id: string
  type: "session.diff"
  properties: {
    sessionID: string
    diff: Array<SnapshotFileDiff>
  }
}
```

#### `session.error`

```typescript
export type EventSessionError = {
  id: string
  type: "session.error"
  properties: {
    sessionID?: string
    error?:
      | ProviderAuthError
      | UnknownError
      | MessageOutputLengthError
      | MessageAbortedError
      | StructuredOutputError
      | ContextOverflowError
      | ContentFilterError
      | ApiError
  }
}
```

#### `session.status`

```typescript
export type EventSessionStatus = {
  id: string
  type: "session.status"
  properties: {
    sessionID: string
    status: SessionStatus
  }
}
```

#### `session.idle`

```typescript
export type EventSessionIdle = {
  id: string
  type: "session.idle"
  properties: {
    sessionID: string
  }
}
```

#### `session.compacted`

```typescript
export type EventSessionCompacted = {
  id: string
  type: "session.compacted"
  properties: {
    sessionID: string
  }
}
```

### todo

#### `todo.updated`

```typescript
export type EventTodoUpdated = {
  id: string
  type: "todo.updated"
  properties: {
    sessionID: string
    todos: Array<Todo>
  }
}
```

### tui

#### `tui.prompt.append`

```typescript
export type EventTuiPromptAppend2 = {
  id: string
  type: "tui.prompt.append"
  properties: {
    text: string
  }
}
```

#### `tui.command.execute`

```typescript
export type EventTuiCommandExecute2 = {
  id: string
  type: "tui.command.execute"
  properties: {
    command:
      | "session.list"
      | "session.new"
      | "session.share"
      | "session.interrupt"
      | "session.compact"
      | "session.page.up"
      | "session.page.down"
      | "session.line.up"
      | "session.line.down"
      | "session.half.page.up"
      | "session.half.page.down"
      | "session.first"
      | "session.last"
      | "prompt.clear"
      | "prompt.submit"
      | "agent.cycle"
      | string
  }
}
```

#### `tui.toast.show`

```typescript
export type EventTuiToastShow2 = {
  id: string
  type: "tui.toast.show"
  properties: {
    title?: string
    message: string
    variant: "info" | "success" | "warning" | "error"
    duration?: number
  }
}
```

#### `tui.session.select`

```typescript
export type EventTuiSessionSelect2 = {
  id: string
  type: "tui.session.select"
  properties: {
    /**
     * Session ID to navigate to
     */
    sessionID: string
  }
}
```

### vcs

#### `vcs.branch.updated`

```typescript
export type EventVcsBranchUpdated = {
  id: string
  type: "vcs.branch.updated"
  properties: {
    branch?: string
  }
}
```

### workspace

#### `workspace.ready`

```typescript
export type EventWorkspaceReady = {
  id: string
  type: "workspace.ready"
  properties: {
    name: string
  }
}
```

#### `workspace.failed`

```typescript
export type EventWorkspaceFailed = {
  id: string
  type: "workspace.failed"
  properties: {
    message: string
  }
}
```

#### `workspace.status`

```typescript
export type EventWorkspaceStatus = {
  id: string
  type: "workspace.status"
  properties: {
    workspaceID: string
    status: "connected" | "connecting" | "disconnected" | "error"
  }
}
```

### worktree

#### `worktree.ready`

```typescript
export type EventWorktreeReady = {
  id: string
  type: "worktree.ready"
  properties: {
    name: string
    branch?: string
  }
}
```

#### `worktree.failed`

```typescript
export type EventWorktreeFailed = {
  id: string
  type: "worktree.failed"
  properties: {
    message: string
  }
}
```
