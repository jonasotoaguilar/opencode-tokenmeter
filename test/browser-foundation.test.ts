import { describe, expect, test } from "bun:test"
import { homedir } from "node:os"
import { parse } from "node:path"
import { withConcurrency } from "../src/tokenmeter/browser/concurrency"
import {
  BROWSER_COMMAND_NAME,
  BROWSER_CONCURRENCY,
  FETCH_TIMEOUT_MS,
  PAGE_SIZE,
} from "../src/tokenmeter/browser/constants"
import { isSafeDirectory } from "../src/tokenmeter/browser/is-safe-directory"
import { withTimeout } from "../src/tokenmeter/browser/timeout"

describe("browser foundation", () => {
  test("constants are defined", () => {
    expect(BROWSER_COMMAND_NAME).toBe("tokenmeter.browser")
    expect(BROWSER_CONCURRENCY).toBeGreaterThan(0)
    expect(FETCH_TIMEOUT_MS).toBe(4000)
    expect(PAGE_SIZE).toBe(200)
  })
  test("isSafeDirectory guards root, homedir and safe paths", () => {
    expect(isSafeDirectory("/")).toBe(false)
    expect(isSafeDirectory(homedir())).toBe(false)
    expect(isSafeDirectory(parse("/").root)).toBe(false)
    expect(isSafeDirectory("/safe/path")).toBe(true)
    expect(isSafeDirectory("/tmp/proj")).toBe(true)
  })
  test("withConcurrency limits parallelism", async () => {
    let max = 0
    let cur = 0
    const items = [0, 1, 2, 3, 4, 5]
    const out: number[] = []
    await withConcurrency(items, 2, async (item) => {
      cur++
      max = Math.max(max, cur)
      await new Promise<void>((r) => setTimeout(r, 5))
      out.push(item)
      cur--
    })
    expect(out.sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5])
    expect(max).toBe(2)
  })
  test("withTimeout resolves and rejects on timeout", async () => {
    await expect(withTimeout(Promise.resolve(42), 100)).resolves.toBe(42)
    await expect(withTimeout(new Promise(() => {}), 10)).rejects.toThrow()
  })
})
