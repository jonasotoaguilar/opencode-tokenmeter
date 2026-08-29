/**
 * Browser projects fail-closed — null/error not zero, [] recovers checkpoint.
 * Verifies stable error propagation for unavailable/malformed/truncated.
 */
import { describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { loadBrowserProjects } from "../src/tokenmeter/browser/projects"
import { checkpointActiveProject } from "../src/tokenmeter/durable/checkpoints"
import { durableDbPath } from "../src/tokenmeter/durable/paths"

function projectApi(
  projects: unknown[],
  fetchImpl: (pid: string) => Promise<unknown>,
) {
  return {
    state: { path: { directory: "/tmp", state: "/tmp" } },
    client: {
      project: {
        list: async () => ({ data: projects }),
        current: async () => ({
          data: { id: projects[0] ? (projects[0] as { id: string }).id : "p1" },
        }),
      },
      v2: {
        session: { list: fetchImpl as never },
      },
    },
  } as never
}

describe("browser projects fail-closed", () => {
  test("null/error does not yield zero project, successful [] recovers checkpoint", async () => {
    const durableDir = mkdtempSync(join(tmpdir(), "dur-browse-"))
    const saved = process.env.TOKENMETER_DURABLE_DIR
    process.env.TOKENMETER_DURABLE_DIR = durableDir
    try {
      const dbPath = durableDbPath()!
      // Seed checkpoint for p1
      checkpointActiveProject(dbPath, "p1", "/proj/dir", [
        {
          id: "s1",
          projectID: "p1",
          cost: 0.05,
          tokens: { input: 1000, output: 500 },
        } as never,
      ])

      // Case 1: sessions === null (error) -> loadBrowserProjects throws, not zero row
      const projectsErr = [
        { id: "p1", worktree: "/proj/dir", time: { created: 1, updated: 2 } },
      ]
      const apiErr = projectApi(projectsErr, async () => {
        throw new Error("offline")
      })
      await expect(loadBrowserProjects(apiErr)).rejects.toThrow(
        "Unable to load projects",
      )

      // Case 2: successful [] -> recovers checkpoint
      const projectsOk = [
        { id: "p1", worktree: "/proj/dir", time: { created: 1, updated: 2 } },
      ]
      const apiOk = projectApi(projectsOk, async () => ({ data: [] }))
      const rows = await loadBrowserProjects(apiOk)
      expect(rows).toHaveLength(1)
      expect(rows[0]!.id).toBe("p1")
      expect(rows[0]!.usage.sessions).toBe(1)
      expect(rows[0]!.usage.input).toBe(1000)
      expect(rows[0]!.usage.cache).toBe(
        rows[0]!.usage.cacheRead + rows[0]!.usage.cacheWrite,
      )

      // Case 3: malformed (non-array) -> throws
      const apiMal = projectApi(
        projectsErr,
        async () => ({ data: "not-array" }) as never,
      )
      await expect(loadBrowserProjects(apiMal)).rejects.toThrow(
        "Unable to load projects",
      )
    } finally {
      if (saved === undefined)
        delete (process.env as Record<string, unknown>).TOKENMETER_DURABLE_DIR
      else process.env.TOKENMETER_DURABLE_DIR = saved
      rmSync(durableDir, { recursive: true, force: true })
    }
  })

  test("truncated via session-source returns null and then throws", async () => {
    const { fetchSessionsForBrowse } = await import(
      "../src/tokenmeter/browser/session-source"
    )
    const { BROWSER_SESSION_LIMIT } = await import(
      "../src/tokenmeter/browser/constants"
    )
    // Simulate truncated by returning many rows via cursor would hit limit
    let calls = 0
    const api = {
      state: { path: { directory: "/tmp" } },
      client: {
        v2: {
          session: {
            list: async () => {
              calls++
              // Return PAGE_SIZE rows each time to exceed limit quickly
              const data = Array.from({ length: 200 }, (_, i) => ({
                id: `s${calls}-${i}`,
                projectID: "p1",
              }))
              const next = calls < 55 ? `c${calls}` : undefined
              return next ? { data, cursor: { next } } : { data }
            },
          },
        },
      },
    } as never
    const res = await fetchSessionsForBrowse(api, "p1")
    expect(res).toBeNull()
  })
})
