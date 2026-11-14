import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as http from "../../src/company/http.js";
import { SourceError } from "../../src/company/http.js";
import { FakeHTTP, FakeResponse } from "./helpers.js";

describe("company/http", () => {
  let fakeHttp: FakeHTTP;

  beforeEach(() => {
    http.resetThrottle();
    fakeHttp = new FakeHTTP();
    fakeHttp.install();
    vi.spyOn(http._clock, "sleep").mockImplementation(async () => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    http.resetThrottle();
  });

  it("test_get_json", async () => {
    const timeoutSpy = vi.spyOn(AbortSignal, "timeout");
    fakeHttp.add("example.com", new FakeResponse({ jsonData: { a: 1 } }));
    const res = await http.request("src", "GET", "https://example.com/x", { params: { k: "v" } });
    expect(res).toEqual({ a: 1 });
    expect(timeoutSpy).toHaveBeenCalledWith(http.TIMEOUT_MS);
    expect(fakeHttp.calls[0].signal).toBeInstanceOf(AbortSignal);
    expect(fakeHttp.calls[0].headers["cookie"]).toBeUndefined();
    expect(fakeHttp.calls[0].params).toEqual({ k: "v" });
  });

  it("test_post_json_sends_body", async () => {
    fakeHttp.add("example.com", new FakeResponse({ jsonData: { ok: true } }));
    await http.request("src", "POST", "https://example.com/g", { json: { query: "q" } });
    expect(fakeHttp.calls[0].method).toBe("POST");
    expect(fakeHttp.calls[0].json).toEqual({ query: "q" });
  });

  it("test_text_mode", async () => {
    fakeHttp.add("example.com", new FakeResponse({ body: "<html>hi</html>" }));
    const res = await http.request("src", "GET", "https://example.com/", { expect: "text" });
    expect(res).toBe("<html>hi</html>");
  });

  it("test_empty_body_is_none_when_allowed", async () => {
    fakeHttp.add("example.com", new FakeResponse({ status: 200, body: "" }));
    const res = await http.request("src", "GET", "https://example.com/", { allowEmpty: true });
    expect(res).toBeNull();
  });

  it("test_empty_body_is_schema_error_by_default", async () => {
    fakeHttp.add("example.com", new FakeResponse({ status: 200, body: "" }));
    await expect(http.request("src", "GET", "https://example.com/")).rejects.toSatisfy(
      (e: unknown) => e instanceof SourceError && e.type === "schema",
    );
  });

  it.each([
    [403, "blocked"],
    [429, "blocked"],
    [404, "http"],
    [500, "http"],
  ] as const)("test_error_status %i -> %s", async (status, kind) => {
    fakeHttp.add("example.com", new FakeResponse({ status, body: "x" }));
    await expect(http.request("src", "GET", "https://example.com/")).rejects.toSatisfy(
      (e: unknown) =>
        e instanceof SourceError &&
        e.type === kind &&
        e.status === status &&
        e.message.includes(String(status)),
    );
  });

  it("test_normal_page_with_challenge_platform_script_is_not_blocked", async () => {
    const html =
      '<html><head><title>Yourator 職缺</title></head><body><script src="/cdn-cgi/challenge-platform/h/b/scripts/jsd/abc/main.js"></script></body></html>';
    fakeHttp.add("example.com", new FakeResponse({ status: 200, body: html }));
    const res = await http.request("src", "GET", "https://example.com/", { expect: "text" });
    expect(res).toBe(html);
  });

  it.each([
    '<html><head><title>Just a moment...</title></head><body><script>window._cf_chl_opt={cvId: "3"};</script></body></html>',
    "<html><head><title>Just a moment...</title></head><body></body></html>",
    "<html><head><title>Attention Required! | Cloudflare</title></head><body></body></html>",
    '<html><body><script>window._cf_chl_opt={cvId: "3"};</script></body></html>',
  ])("test_cloudflare_challenge_text_is_blocked %s", async (body) => {
    fakeHttp.add("example.com", new FakeResponse({ status: 200, body }));
    await expect(
      http.request("src", "GET", "https://example.com/", { expect: "text" }),
    ).rejects.toSatisfy((e: unknown) => e instanceof SourceError && e.type === "blocked");
  });

  it("test_network_error", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new DOMException("Timed out", "TimeoutError"));
    await expect(http.request("src", "GET", "https://example.com/")).rejects.toSatisfy(
      (e: unknown) => e instanceof SourceError && e.type === "network",
    );
  });

  it("test_invalid_json_is_schema_error", async () => {
    fakeHttp.add("example.com", new FakeResponse({ status: 200, body: "<html>", contentType: "application/json" }));
    await expect(http.request("src", "GET", "https://example.com/")).rejects.toSatisfy(
      (e: unknown) => e instanceof SourceError && e.type === "schema",
    );
  });

  it("test_same_source_spaced_two_seconds", async () => {
    fakeHttp.add("example.com", new FakeResponse({ jsonData: {} }));
    let now = 100_000;
    const slept: number[] = [];
    vi.spyOn(http._clock, "now").mockImplementation(() => now);
    vi.spyOn(http._clock, "sleep").mockImplementation(async (ms) => {
      slept.push(ms);
      now += ms;
    });
    await http.request("a", "GET", "https://example.com/1");
    now += 500;
    await http.request("a", "GET", "https://example.com/2");
    expect(slept).toHaveLength(1);
    expect(slept[0]).toBeCloseTo(1500, 5);
  });

  it("test_different_sources_do_not_wait", async () => {
    fakeHttp.add("example.com", new FakeResponse({ jsonData: {} }));
    const slept: number[] = [];
    vi.spyOn(http._clock, "sleep").mockImplementation(async (ms) => {
      slept.push(ms);
    });
    await http.request("a", "GET", "https://example.com/1");
    await http.request("b", "GET", "https://example.com/2");
    expect(slept).toEqual([]);
  });

  it("test_sources_throttle_independently", async () => {
    fakeHttp.add("example.com", new FakeResponse({ jsonData: {} }));
    let now = 100_000;
    vi.spyOn(http._clock, "now").mockImplementation(() => now);
    http._last.set("a", now);

    let markStarted!: () => void;
    const started = new Promise<void>((r) => {
      markStarted = r;
    });
    let releaseA!: () => void;
    const gateA = new Promise<void>((r) => {
      releaseA = r;
    });

    vi.spyOn(http._clock, "sleep").mockImplementation(async () => {
      markStarted();
      await gateA;
    });

    const reqA = http.request("a", "GET", "https://example.com/1");
    await started;

    const order: string[] = [];
    const reqB = http.request("b", "GET", "https://example.com/2").then(() => {
      order.push("b");
    });
    await reqB;
    expect(order).toEqual(["b"]);

    releaseA();
    await reqA.then(() => {
      order.push("a");
    });
    expect(order).toEqual(["b", "a"]);
  });

  it("test_graphql_returns_data_key", async () => {
    fakeHttp.add("example.com", new FakeResponse({ jsonData: { data: { x: [1] } } }));
    const res = await http.graphql("src", "https://example.com/g", "query{x}", { a: 1 }, "x");
    expect(res).toEqual([1]);
    expect(fakeHttp.calls[0].json).toEqual({ query: "query{x}", variables: { a: 1 } });
  });

  it.each([
    { errors: [{ message: "boom" }] },
    { data: {} },
    { data: null },
    ["x"],
  ])("test_graphql_errors_or_missing_key_are_schema_errors %j", async (payload) => {
    fakeHttp.add("example.com", new FakeResponse({ jsonData: payload }));
    await expect(http.graphql("src", "https://example.com/g", "query{x}", {}, "x")).rejects.toSatisfy(
      (e: unknown) => e instanceof SourceError && e.type === "schema",
    );
  });
});
