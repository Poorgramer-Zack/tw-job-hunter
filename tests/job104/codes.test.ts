import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as codes from "../../src/job104/codes.js";
import { fakeResponse, installFakeFetch, installOfflineCodes, resetJob104State } from "./helpers.js";

beforeEach(() => {
  resetJob104State();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("job104 codes", () => {
  it.each([
    ["台北市", "6001001000"],
    ["臺北市", "6001001000"],
    [" 台北市 ", "6001001000"],
    ["新北市板橋區", "6001002003"],
    ["板橋", "6001002003"],
  ])("test_area_lookup %s -> %s", async (name, code) => {
    installOfflineCodes();
    await expect(codes.areaCode(name)).resolves.toBe(code);
  });

  it("test_area_unknown", async () => {
    installOfflineCodes();
    await expect(codes.areaCode("火星")).rejects.toThrow("無法辨識的地區");
  });

  it("test_area_ambiguous_lists_candidates", async () => {
    installOfflineCodes();
    await expect(codes.areaCode("中正區")).rejects.toThrow(/多個符合.*中正區/);
  });

  it("test_jobcat_lookup", async () => {
    installOfflineCodes();
    await expect(codes.jobcatCode("軟體工程師")).resolves.toBe("2007001004");
  });

  it("test_table_cached", async () => {
    const calls = installFakeFetch(fakeResponse({ jsonData: [{ no: "1", des: "甲" }] }));
    await codes.areaCode("甲");
    await codes.areaCode("甲");
    expect(calls).toHaveLength(1);
  });
});
