import { describe, expect, test } from "bun:test"
import { isSafeDirectory } from "../src/tokenmeter/browser/is-safe-directory"

describe("browser directories", () => {
  test("isSafeDirectory guards roots", () => {
    expect(isSafeDirectory("/")).toBe(false)
    expect(isSafeDirectory("/tmp")).toBe(true)
  })
})

import {
  resolveBrowseDirectory,
  resolveDirectory,
  resolveSafeDirectory,
  resolveSafeWorktree,
} from "../src/tokenmeter/browser/directories"

describe("browser directories resolve", () => {
  test("resolveSafeDirectory prefers directories candidate", async () => {
    const api = {
      state: { path: { directory: "/tmp" } },
      client: {
        project: {
          directories: async () => ({ data: ["/tmp/proj"] }),
          current: async () => ({ data: { id: "proj1" } }),
        },
      },
    } as never
    const res = await resolveSafeDirectory(api, "proj1", undefined, null)
    expect(res).toBe("/tmp/proj")
  })
  test("resolveSafeDirectory falls back to worktree", async () => {
    const api = {
      state: { path: { directory: "/tmp" } },
      client: {
        project: {
          directories: async () => ({ data: [] }),
          current: async () => ({ data: { id: "other" } }),
        },
      },
    } as never
    const res = await resolveSafeDirectory(api, "proj1", "/tmp/wt", null)
    expect(res).toBe("/tmp/wt")
  })
  test("resolveBrowseDirectory mirrors safe directory", async () => {
    const api = {
      state: { path: { directory: "/tmp" } },
      client: {
        project: {
          directories: async () => ({ data: [] }),
          current: async () => ({ data: { id: "proj1" } }),
        },
      },
    } as never
    const res = await resolveBrowseDirectory(api, "proj1", "/tmp/wt", "proj1")
    expect(res).toBe("/tmp/wt")
  })
  test("resolveSafeWorktree checks host current", async () => {
    const api = {
      state: { path: { directory: "/tmp" } },
      client: {
        project: {
          directories: async () => ({ data: [] }),
          current: async ({ directory }: { directory: string }) => ({
            data: { id: directory === "/tmp" ? "proj1" : "other" },
          }),
        },
      },
    } as never
    const res = await resolveSafeWorktree(api, "proj1", undefined)
    expect(res).toBe("/tmp")
  })
  test("resolveDirectory returns safe or empty", async () => {
    const api = {
      state: { path: { directory: "/tmp" } },
      client: {
        project: {
          directories: async () => ({ data: [] }),
          current: async () => ({ data: { id: "proj1" } }),
        },
      },
    } as never
    const res = await resolveDirectory(api, "proj1", "/tmp/wt")
    expect(typeof res).toBe("string")
  })
})
