import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as links from "../../src/company/links.js";
import * as web from "../../src/company/web.js";
import { loadCompany } from "./helpers.js";

describe("company/web & links", () => {
  let lastClient: { apiKey: string; calls: Array<[string, Record<string, unknown> | undefined]> } | null;
  let mockRaises: Error | null;
  let mockPayload: Record<string, any> | null;

  beforeEach(() => {
    lastClient = null;
    mockRaises = null;
    mockPayload = null;
    vi.spyOn(web._deps, "createClient").mockImplementation((apiKey: string) => {
      const state = { apiKey, calls: [] as Array<[string, Record<string, unknown> | undefined]> };
      lastClient = state;
      return {
        async search(query: string, options?: Record<string, unknown>) {
          state.calls.push([query, options]);
          if (mockRaises) {
            throw mockRaises;
          }
          return mockPayload ?? loadCompany("tavily_search.json");
        },
      };
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function resultsFor(...urls: string[]) {
    const p = structuredClone(loadCompany<Record<string, any>>("tavily_search.json"));
    p.results = urls.map((u, i) => ({ title: `t${i}`, url: u, content: "內容", score: 0.5 }));
    return p;
  }

  it("test_search_with_key", async () => {
    const out = await web.search("台灣積體電路製造股份有限公司", "tvly-abc");
    expect(out.status).toBe("ok");
    if (out.status !== "ok") throw new Error("unreachable");
    expect(out.truncated).toBe(false);
    const [q, kw] = lastClient!.calls[0];
    expect(q).toContain('"台灣積體電路製造股份有限公司"');
    expect(kw?.exactMatch).toBe(true);
    expect(kw?.includeDomains).toEqual(["dcard.tw", "ptt.cc"]);
    expect(kw?.maxResults).toBe(20);
    expect(kw?.searchDepth).toBe("basic");
    const r = out.results[0];
    expect(Object.keys(r).sort()).toEqual(["snippet", "source", "title", "url"]);
    expect(["dcard", "ptt"]).toContain(r.source);
  });

  it("test_only_job_related_boards_are_kept", async () => {
    mockPayload = resultsFor(
      "https://www.ptt.cc/bbs/Tech_Job/M.1.A.AAA.html",
      "https://www.ptt.cc/bbs/Stock/M.2.A.BBB.html",
      "https://www.ptt.cc/bbs/studyabroad/M.3.A.CCC.html",
      "https://www.ptt.cc/bbs/Salary/M.4.A.DDD.html",
      "https://www.dcard.tw/f/tech_job/p/1",
      "https://www.dcard.tw/f/job/p/2",
      "https://www.dcard.tw/f/mood/p/3",
      "https://www.dcard.tw/topics/%E6%8A%80%E8%A1%93%E5%93%A1",
    );
    const out = await web.search("某公司", "k");
    expect(out.results.map((r) => r.url)).toEqual([
      "https://www.ptt.cc/bbs/Tech_Job/M.1.A.AAA.html",
      "https://www.ptt.cc/bbs/Salary/M.4.A.DDD.html",
      "https://www.dcard.tw/f/tech_job/p/1",
      "https://www.dcard.tw/f/job/p/2",
    ]);
  });

  it("test_board_match_is_case_insensitive", async () => {
    mockPayload = resultsFor(
      "https://www.ptt.cc/bbs/tech_job/M.1.A.AAA.html",
      "https://www.dcard.tw/f/Tech_Job/p/9",
    );
    const out = await web.search("某公司", "k");
    expect(out.results).toHaveLength(2);
  });

  it("test_no_relevant_board_gives_empty_ok", async () => {
    mockPayload = resultsFor("https://www.ptt.cc/bbs/Stock/M.2.A.BBB.html");
    const out = await web.search("某公司", "k");
    expect(out.status).toBe("ok");
    if (out.status !== "ok") throw new Error("unreachable");
    expect(out.results).toEqual([]);
    expect(out.truncated).toBe(false);
  });

  it("test_snippet_clipped_to_300", async () => {
    const p = structuredClone(loadCompany<Record<string, any>>("tavily_search.json"));
    p.results[0].content = "字".repeat(1000);
    mockPayload = p;
    const out = await web.search("某公司", "k");
    expect((out.results[0].snippet ?? "").length).toBeLessThanOrEqual(301);
  });

  it("test_more_than_ten_results_truncated", async () => {
    const p = structuredClone(loadCompany<Record<string, any>>("tavily_search.json"));
    p.results = Array.from({ length: 12 }, (_, i) => ({
      ...p.results[0],
      url: `https://www.ptt.cc/bbs/Tech_Job/M.${i}.html`,
    }));
    mockPayload = p;
    const out = await web.search("某公司", "k");
    if (out.status !== "ok") throw new Error("unreachable");
    expect(out.results).toHaveLength(10);
    expect(out.truncated).toBe(true);
  });

  it.each([null, undefined, ""])("test_no_usable_key_is_skipped (%j)", async (key) => {
    const out = await web.search("某公司", key);
    expect(out.status).toBe("skipped");
    expect(out.results).toEqual([]);
    if (out.status !== "skipped") throw new Error("unreachable");
    expect(out.note).toContain("金鑰");
    expect(lastClient).toBeNull();
  });

  it("test_tavily_failure_is_error", async () => {
    mockRaises = new Error("quota exceeded");
    const out = await web.search("某公司", "k");
    expect(out.status).toBe("error");
    if (out.status !== "error") throw new Error("unreachable");
    expect(out.error.type).toBe("web_search");
    expect(out.error.message).toContain("quota");
  });

  it("test_only_dcard_and_ptt_never_requested_directly", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("direct HTTP request"));
    const out = await web.search("某公司", "k");
    expect(out.status).toBe("ok");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("test_links_use_known_ids", () => {
    const ln = links.build("台灣積體電路製造股份有限公司", {
      goodjobName: "台積電 TSMC",
      qollieId: "abc",
      itwShortId: "KYRX",
    });
    expect(ln.goodjob).toBe("https://www.goodjob.life/companies/%E5%8F%B0%E7%A9%8D%E9%9B%BB%20TSMC");
    expect(ln.qollie).toBe("https://www.qollie.com/companies/abc");
    expect(ln.interview_tw).toBe("https://interview.tw/c/KYRX");
    expect(ln.salary_tw).toBe("https://salary.tw/c/KYRX");
    expect(Object.keys(ln).sort()).toEqual([
      "dcard",
      "goodjob",
      "interview_tw",
      "ptt",
      "qollie",
      "salary_tw",
    ]);
  });

  it("test_links_fall_back_to_search_with_official_name", () => {
    const ln = links.build("台灣積體電路製造股份有限公司");
    expect(ln.qollie).toContain("%E5%8F%B0%E7%81%A3%E7%A9%8D%E9%AB%94%E9%9B%BB%E8%B7%AF%E8%A3%BD%E9%80%A0");
    expect(Object.values(ln).every((v) => v.startsWith("https://"))).toBe(true);
    expect(ln.dcard).toContain("dcard.tw");
    expect(ln.ptt).toContain("ptt.cc");
  });
});
