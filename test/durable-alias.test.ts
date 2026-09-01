/**
 * Alias normalization — pure Windows and ensureDirForDb.
 * Split from durable-paths for SHOULD <=200.
 */
import { describe, expect, test } from "bun:test"
import {
  durableDbPath,
  normalizeAlias,
  resolveDurableDir,
} from "../src/tokenmeter/durable/paths"

describe("durable alias — pure Windows", () => {
  test("Windows separators, case folding, and absolute-only", () => {
    expect(normalizeAlias("C:\\Users\\u\\Project", "win32")).toBe(
      "c:\\users\\u\\project",
    )
    expect(normalizeAlias("C:/Users/u/Project/", "win32")).toBe(
      "c:\\users\\u\\project",
    )
    expect(normalizeAlias("C:\\", "win32")).toBe("")
    expect(normalizeAlias("relative\\path", "win32")).toBe("")
    expect(
      resolveDurableDir({
        env: { TOKENMETER_DURABLE_DIR: "C:\\tmp\\override" },
        platform: "win32",
        homedir: "C:\\Users\\u",
      }),
    ).toBe("c:\\tmp\\override")
    expect(
      resolveDurableDir({
        env: { TOKENMETER_DURABLE_DIR: "relative\\path" },
        platform: "win32",
        homedir: "C:\\Users\\u",
      }),
    ).toBeNull()
    expect(
      resolveDurableDir({
        env: { APPDATA: "C:\\Users\\u\\AppData\\Roaming" },
        platform: "win32",
        homedir: "C:\\Users\\u",
      })!.toLowerCase(),
    ).toContain("opencode-tokenmeter")
  })

  test("Windows homedir and root are rejected", () => {
    expect(
      resolveDurableDir({
        env: { TOKENMETER_DURABLE_DIR: "C:\\Users\\u" },
        platform: "win32",
        homedir: "C:\\Users\\u",
      }),
    ).toBeNull()
    expect(
      resolveDurableDir({
        env: { TOKENMETER_DURABLE_DIR: "C:\\" },
        platform: "win32",
        homedir: "C:\\Users\\u",
      }),
    ).toBeNull()
    expect(normalizeAlias("C:\\Users\\u\\Project", "win32")).toBe(
      "c:\\users\\u\\project",
    )
    expect(normalizeAlias("C:\\", "win32")).toBe("")
  })

  test("Windows durableDbPath joins with win32 separator", () => {
    const p = durableDbPath({
      dataDir: "C:\\tmp\\override",
      platform: "win32",
      homedir: "C:\\Users\\u",
    })!
    expect(p.toLowerCase()).toBe("c:\\tmp\\override\\checkpoints.sqlite")
  })
})
