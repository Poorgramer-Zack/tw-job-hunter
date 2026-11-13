import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as client from "../../src/job104/client.js";
import {
  Blocked104Error,
  Network104Error,
  NotFound104Error,
  Schema104Error,
} from "../../src/job104/client.js";
import { fakeResponse, installFakeFetch, resetJob104State } from "./helpers.js";

const URL = "https://www.104.com.tw/x";

beforeEach(() => {
  resetJob104State();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("job104 client", () => {
  it("test_ok_json", async () => {
    const calls = installFakeFetch(fakeResponse({ jsonData: { a: 1 } }));
    const res = await client.getJson(URL, { k: "v" }, "https://www.104.com.tw/jobs/search/");
    expect(res).toEqual({ a: 1 });
    expect(calls[0].params).toEqual({ k: "v" });
    const h = calls[0].headers;
    expect(h.Referer).toBe("https://www.104.com.tw/jobs/search/");
    expect(h["User-Agent"].startsWith("Mozilla/5.0")).toBe(true);
    expect(calls[0].signal).toBeInstanceOf(AbortSignal);
  });

  it("test_no_cookie_sent", async () => {
    const calls = installFakeFetch(fakeResponse({ jsonData: {} }));
    await client.getJson(URL);
    expect("Cookie" in calls[0].headers).toBe(false);
    expect(calls[0].credentials).toBe("omit");
  });

  it.each([403, 429])("test_blocked_status %i", async (status) => {
    installFakeFetch(fakeResponse({ status, body: "<html>" }));
    await expect(client.getJson(URL)).rejects.toThrow(Blocked104Error);
    await expect(client.getJson(URL)).rejects.toThrow(String(status));
  });

  it("test_challenge_page_with_200", async () => {
    installFakeFetch(
      fakeResponse({
        status: 200,
        body: "<html><script src='/cdn-cgi/challenge-platform/x'></script></html>",
      }),
    );
    await expect(client.getJson(URL)).rejects.toThrow(Blocked104Error);
  });

  it("test_404", async () => {
    installFakeFetch(
      fakeResponse({
        status: 404,
        jsonData: { error: { code: 11201, message: "職務不存在" } },
      }),
    );
    await expect(client.getJson(URL)).rejects.toThrow(NotFound104Error);
  });

  it("test_5xx", async () => {
    installFakeFetch(fakeResponse({ status: 502, body: "bad gateway" }));
    await expect(client.getJson(URL)).rejects.toThrow(Network104Error);
    await expect(client.getJson(URL)).rejects.toThrow("502");
  });

  it("test_timeout", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new DOMException("The operation was aborted due to timeout", "TimeoutError"));
    await expect(client.getJson(URL)).rejects.toThrow(Network104Error);
    await expect(client.getJson(URL)).rejects.toThrow(/Timeout/);
  });

  it("test_non_json_200", async () => {
    installFakeFetch(fakeResponse({ status: 200, body: "<html>maintenance</html>" }));
    await expect(client.getJson(URL)).rejects.toThrow(Schema104Error);
  });

  it("test_throttle_spaces_requests", async () => {
    installFakeFetch(fakeResponse({ jsonData: {} }));
    let now = 100_000;
    const slept: number[] = [];
    client._resetThrottleForTest();
    client._setClockForTest({
      now: () => now,
      sleep: async (ms) => {
        slept.push(ms);
        now += ms;
      },
    });

    await client.getJson(URL);
    now += 300;
    await client.getJson(URL);
    expect(slept).toHaveLength(1);
    expect(slept[0]).toBeCloseTo(700);
  });

  it("test_throttle_serializes_concurrent_calls", async () => {
    installFakeFetch(fakeResponse({ jsonData: {} }));
    let now = 100_000;
    const slept: number[] = [];
    client._resetThrottleForTest();
    client._setClockForTest({
      now: () => now,
      sleep: async (ms) => {
        slept.push(ms);
        now += ms;
      },
    });

    await Promise.all([client.getJson(URL), client.getJson(URL)]);
    expect(slept).toEqual([1000]);
  });
});
