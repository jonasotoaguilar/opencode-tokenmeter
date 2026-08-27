import { describe, expect, test } from "bun:test"
import {
  __resetBrowserActivityForTest,
  createBrowserActivity,
} from "../src/tokenmeter/browser/browser-activity"

function mockApi() {
  let clears = 0
  const api = {
    ui: {
      dialog: {
        clear: () => {
          clears++
        },
      },
    },
  } as never
  return { api, clears: () => clears }
}

describe("browser-activity route generation", () => {
  test("isActive true initially, deactivate makes false", () => {
    __resetBrowserActivityForTest()
    const { api } = mockApi()
    const a = createBrowserActivity(api)
    expect(a.isActive()).toBe(true)
    a.deactivate()
    expect(a.isActive()).toBe(false)
  })

  test("close is idempotent and clears once", () => {
    __resetBrowserActivityForTest()
    const { api, clears } = mockApi()
    const a = createBrowserActivity(api)
    a.close()
    expect(clears()).toBe(1)
    expect(a.isActive()).toBe(false)
    a.close()
    expect(clears()).toBe(1)
  })

  test("new route deactivates previous", () => {
    __resetBrowserActivityForTest()
    const { api: api1 } = mockApi()
    const { api: api2 } = mockApi()
    const a1 = createBrowserActivity(api1)
    expect(a1.isActive()).toBe(true)
    const a2 = createBrowserActivity(api2)
    expect(a2.isActive()).toBe(true)
    expect(a1.isActive()).toBe(false)
  })

  test("deactivate is idempotent", () => {
    __resetBrowserActivityForTest()
    const { api } = mockApi()
    const a = createBrowserActivity(api)
    a.deactivate()
    expect(a.isActive()).toBe(false)
    a.deactivate()
    expect(a.isActive()).toBe(false)
  })
})
