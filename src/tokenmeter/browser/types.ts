/**
 * Browser type definitions.
 * Single authority for the host API shape used by aggregator,
 * project/session detail and the dialog layers.
 */

import type { JSX } from "solid-js"
import type { ProjectUsage } from "../types"

export type RawProject = {
  id: string
  worktree?: string
  name?: string
  time?: { created?: number; updated?: number }
}

export type BrowserProject = {
  id: string
  label: string
  worktree?: string
  time: { created: number; updated: number }
  usage: ProjectUsage
  lastActive: number
  isCurrent: boolean
}

export type BrowserApi = {
  state: { path: { directory: string; state: string } }
  client: {
    project: {
      list(params?: unknown): Promise<{ data?: unknown }>
      current(params: { directory: string }): Promise<{ data?: { id: string } }>
      directories?(params: { projectID: string }): Promise<{ data?: unknown }>
    }
    session: {
      list(params: Record<string, unknown>): Promise<{ data?: unknown }>
    }
    v2?: {
      session?: { list?(params: Record<string, unknown>): Promise<unknown> }
    }
    model?: { list?(params?: unknown): Promise<unknown> }
  }
  route?: { current?: { name?: string; params?: Record<string, unknown> } }
  currentSessionID?: string
}

export type BrowserDialogApi = BrowserApi & {
  ui: {
    dialog: {
      replace(r: () => JSX.Element, c?: () => void): void
      clear(): void
    }
    DialogSelect: (p: {
      title: string
      options: Array<{
        title: string
        value: string
        description?: string
        category?: string
        disabled?: boolean
      }>
      onSelect?: (o: { title: string; value: string }) => void
    }) => JSX.Element
    toast: (i: { message: string }) => void
  }
}
