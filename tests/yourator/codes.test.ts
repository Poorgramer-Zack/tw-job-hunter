import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SourceError } from "../../src/company/http.js";
import * as codes from "../../src/yourator/codes.js";
import {
  FakeHTTP,
  FakeResponse,
  installOfflineYouratorCodes,
  loadYouratorJson,
  resetYouratorState,
} from "./helpers.js";

describe("yourator codes", () => {
  beforeEach(() => {
    resetYouratorState();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each([
    ["台北市", "TPE"],
    ["臺北市", "TPE"],
    [" 台北市 ", "TPE"],
    ["新北市", "NWT"],
    ["台北", "TPE"],
    ["台東", "TTT"],
    ["臺東縣", "TTT"],
    ["海外", "oversea"],
  ])("test_area_lookup %s -> %s", async (name, value) => {
    installOfflineYouratorCodes();
    await expect(codes.areaCode(name)).resolves.toBe(value);
  });

  it("test_area_unknown_lists_available", async () => {
    installOfflineYouratorCodes();
    let caught: unknown;
    try {
      await codes.areaCode("火星");
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(Error);
    const msg = (caught as Error).message;
    expect(msg).toContain("無法辨識的地區");
    expect(msg).toContain("臺北市");
    expect(msg).toContain("新北市");
  });

  it("test_area_ambiguous_lists_candidates", async () => {
    installOfflineYouratorCodes();
    await expect(codes.areaCode("新竹")).rejects.toThrow(/多個符合.*新竹市.*新竹縣/);
  });

  it.each([
    ["前端工程", "前端工程"],
    ["後端工程", "後端工程"],
    ["前端", "前端工程"],
    ["Android 工程師", "Android 工程師"],
  ])("test_category_lookup %s -> %s", async (name, value) => {
    installOfflineYouratorCodes();
    await expect(codes.categoryCode(name)).resolves.toBe(value);
  });

  it("test_category_ambiguous_lists_candidates", async () => {
    installOfflineYouratorCodes();
    await expect(codes.categoryCode("工程師")).rejects.toThrow(/多個符合.*工程師/);
  });

  it("test_category_unknown_lists_available", async () => {
    installOfflineYouratorCodes();
    let caught: unknown;
    try {
      await codes.categoryCode("太空人");
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(Error);
    const msg = (caught as Error).message;
    expect(msg).toContain("無法辨識的職類");
    expect(msg).toContain("前端工程");
  });

  it("test_tables_cached_after_first_fetch", async () => {
    const fh = installOfflineYouratorCodes();
    await codes.areaCode("台北市");
    await codes.areaCode("新北市");
    await codes.categoryCode("前端工程");
    await codes.categoryCode("後端工程");
    expect(fh.calls.filter((c) => c.url.includes("/api/v4/areas"))).toHaveLength(1);
    expect(fh.calls.filter((c) => c.url.includes("/api/v4/job_categories"))).toHaveLength(1);
  });

  it("test_fetch_error_propagates_as_source_error", async () => {
    const fh = new FakeHTTP();
    fh.add("/api/v4/areas", new FakeResponse({ status: 429, body: "rate limited" }));
    fh.install();
    await expect(codes.areaCode("台北市")).rejects.toSatisfy(
      (e: unknown) => e instanceof SourceError && e.type === "blocked" && e.status === 429,
    );
  });

  it("test_schema_error_on_malformed_response", async () => {
    const fh = new FakeHTTP();
    fh.add("/api/v4/areas", new FakeResponse({ jsonData: { payload: {} } }));
    fh.install();
    await expect(codes.areaCode("台北市")).rejects.toSatisfy(
      (e: unknown) => e instanceof SourceError && e.type === "schema",
    );
  });

  it("test_area_uses_anonymous_xhr_headers", async () => {
    const fh = installOfflineYouratorCodes();
    await codes.areaCode("台北市");
    const call = fh.calls[0];
    expect(call.method).toBe("GET");
    expect(call.headers["cookie"]).toBeUndefined();
    expect(call.headers["x-requested-with"]).toBe("XMLHttpRequest");
    expect(call.headers["referer"]).toBe("https://www.yourator.co/jobs");
  });

  it("test_empty_name_rejected_without_request", async () => {
    const fh = new FakeHTTP();
    fh.install();
    await expect(codes.areaCode("  ")).rejects.toThrow("不可為空");
    await expect(codes.categoryCode("")).rejects.toThrow("不可為空");
    expect(fh.calls).toHaveLength(0);
  });

  it("test_fixture_has_23_areas_and_57_categories", () => {
    const areas = loadYouratorJson<{ payload: { areas: unknown[] } }>("areas.json");
    const cats = loadYouratorJson<{ payload: { categoryGroups: Array<{ jobCategories: unknown[] }> } }>(
      "job_categories.json",
    );
    expect(areas.payload.areas).toHaveLength(23);
    const totalSub = cats.payload.categoryGroups.reduce((n, g) => n + g.jobCategories.length, 0);
    expect(totalSub).toBe(57);
  });
});
