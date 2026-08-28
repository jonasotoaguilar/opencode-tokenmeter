// API factories for real-contract tests — project/session detail variants.
// biome-ignore-all lint/suspicious/noExplicitAny: harness uses host types

import type { hostRealContract } from "./real-dialog-contract"

export function mkApiReal(
  hostDir: string,
  stateDir: string,
  a: string,
  b: string,
  hr: ReturnType<typeof hostRealContract>,
) {
  const projects = [
    {
      id: "projA",
      name: "alpha",
      worktree: a,
      time: { created: 1700000000000, updated: 1700000005000 },
    },
    {
      id: "projB",
      name: undefined,
      worktree: b,
      time: { created: 1700000000000, updated: 1700000008000 },
    },
  ]
  const map: Record<string, unknown[]> = {
    [a]: [
      {
        id: "s1",
        title: "one",
        time: { created: 1, updated: 2 },
        parentID: null,
        tokens: { input: 10, output: 5 },
        cost: 0.1,
        model: { providerID: "openai", id: "gpt-4o" },
      },
    ],
    [b]: [
      {
        id: "s2",
        title: "two",
        time: { created: 1, updated: 3 },
        parentID: null,
        tokens: { input: 5, output: 5 },
        cost: 0.05,
        model: { providerID: "openai", id: "gpt-4o" },
      },
    ],
  }
  const projMap: Record<string, unknown[]> = {
    projA: (map as Record<string, unknown[]>)[a] as unknown[],
    projB: (map as Record<string, unknown[]>)[b] as unknown[],
  }
  return {
    state: { path: { directory: hostDir, state: stateDir } },
    client: {
      project: {
        list: async () => ({ data: projects }) as never,
        current: async () => ({ data: { id: "projA" } }) as never,
      },
      session: {
        list: async (p: Record<string, unknown>) => {
          const d = p.directory as string
          if (d && (map as Record<string, unknown[]>)[d])
            return { data: (map as Record<string, unknown[]>)[d] } as never
          return { data: [] } as never
        },
        get: async (p: Record<string, unknown>) =>
          ({
            data: {
              id: p.sessionID,
              projectID: "projA",
              title: "one",
              time: { created: 1, updated: 2 },
              tokens: { input: 10, output: 5 },
              cost: 0.1,
              model: { providerID: "openai", id: "gpt-4o" },
            },
          }) as never,
        messages: async () => ({ data: [] }) as never,
        children: async () => ({ data: [] }) as never,
      },
      model: { list: async () => ({ data: [] }) },
      v2: {
        model: { list: async () => ({ data: [] }) },
        session: {
          list: async (p: Record<string, unknown>) => {
            const pid = p.project as string
            if (pid && projMap[pid]) return { data: projMap[pid] } as never
            return { data: [] } as never
          },
        },
      },
    },
    route: { current: { params: { sessionID: "s1" } } },
    currentSessionID: "s1",
    ui: { dialog: hr.dlg, DialogSelect: hr.capture, toast() {} },
  } as unknown
}

export function mkProjectDetailApi(
  hostDir: string,
  stateDir: string,
  w: string,
  hr: ReturnType<typeof hostRealContract>,
) {
  return {
    state: { path: { directory: hostDir, state: stateDir } },
    client: {
      project: {
        list: async () => ({
          data: [
            {
              id: "projA",
              name: "alpha",
              worktree: w,
              time: { created: 1700000000000, updated: 1700000005000 },
            },
          ],
        }),
        current: async () => ({ data: { id: "projA" } }),
      },
      session: {
        list: async (p: Record<string, unknown>) => {
          const d = (p as { directory?: string }).directory
          if (d === w)
            return {
              data: [
                {
                  id: "s1",
                  title: "one",
                  time: { created: 1, updated: 5 },
                  parentID: null,
                  tokens: {
                    input: 10,
                    output: 5,
                    cache: { read: 0, write: 0 },
                  },
                  cost: 0.1,
                  model: { providerID: "openai", id: "gpt-4o" },
                },
                {
                  id: "s2",
                  title: "two",
                  time: { created: 2, updated: 4 },
                  parentID: null,
                  tokens: { input: 5, output: 5, cache: { read: 0, write: 0 } },
                  cost: 0.05,
                  model: { providerID: "openai", id: "gpt-4o" },
                },
              ],
            }
          return { data: [] }
        },
        get: async () => ({ data: { id: "s1", projectID: "projA" } }),
        messages: async () => ({ data: [] }),
        children: async () => ({ data: [] }),
      },
      model: { list: async () => ({ data: [] }) },
      v2: {
        model: { list: async () => ({ data: [] }) },
        session: { list: async () => ({ data: [] }) },
      },
    },
    route: { current: { params: { sessionID: "s1" } } },
    currentSessionID: "s1",
    ui: { dialog: hr.dlg, DialogSelect: hr.capture, toast() {} },
  } as unknown
}

export function mkSessionDetailApi(
  hostDir: string,
  stateDir: string,
  hr: ReturnType<typeof hostRealContract>,
) {
  return {
    state: { path: { directory: hostDir, state: stateDir } },
    client: {
      project: {
        list: async () => ({
          data: [
            {
              id: "projA",
              name: "alpha",
              worktree: hostDir,
              time: { created: 1, updated: 2 },
            },
          ],
        }),
        current: async () => ({ data: { id: "projA" } }),
      },
      session: {
        list: async () => ({ data: [] }),
        get: async (p: Record<string, unknown>) => ({
          data: {
            id: p.sessionID as string,
            projectID: "projA",
            title: "Alpha",
            time: { created: 1000, updated: 2000 },
            tokens: { input: 0, output: 0, cache: { read: 0, write: 0 } },
            cost: 0,
          },
        }),
        messages: async () => ({ data: [] }),
        children: async () => ({ data: [] }),
      },
      model: { list: async () => ({ data: [] }) },
      v2: {
        model: { list: async () => ({ data: [] }) },
        session: { list: async () => ({ data: [] }) },
      },
    },
    route: { current: { params: { sessionID: "s1" } } },
    currentSessionID: "s1",
    ui: { dialog: hr.dlg, DialogSelect: hr.capture, toast() {} },
  } as unknown
}
