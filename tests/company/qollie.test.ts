import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { shortName } from "../../src/company/common.js";
import * as http from "../../src/company/http.js";
import { SourceError } from "../../src/company/http.js";
import * as qollie from "../../src/company/qollie.js";
import { FakeHTTP, FakeResponse, loadCompany } from "./helpers.js";

const URL = "www.qollie.com/graphql";
const CID = "5860c66430162b7e4c17de29";

function route(fakeHttp: FakeHTTP, opts: { search?: unknown; stat?: unknown; comments?: unknown } = {}) {
  fakeHttp.add(URL, (call) => {
    const q = (call.json as { query: string }).query;
    if (q.includes("searchCompanies")) {
      return new FakeResponse({ jsonData: opts.search ?? loadCompany("qollie_search.json") });
    }
    if (q.includes("getCompanyStat")) {
      return new FakeResponse({ jsonData: opts.stat ?? loadCompany("qollie_stat.json") });
    }
    if (q.includes("searchComments")) {
      return new FakeResponse({ jsonData: opts.comments ?? loadCompany("qollie_comments.json") });
    }
    throw new Error(`unexpected query: ${q}`);
  });
}

function queries(fakeHttp: FakeHTTP): string[] {
  return fakeHttp.calls.map((c) => (c.json as { query: string }).query);
}

describe("company/qollie", () => {
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

  it("test_short_name_strips_company_suffix", () => {
    expect(shortName("台灣積體電路製造股份有限公司")).toBe("台灣積體電路製造");
    expect(shortName("某某有限公司")).toBe("某某");
    expect(shortName("某某")).toBe("某某");
  });

  it("test_stats_only", async () => {
    route(fakeHttp);
    const out = await qollie.get("台灣積體電路製造股份有限公司", "22099131", { includeReviews: false });
    expect(out.status).toBe("ok");
    if (out.status !== "ok") throw new Error("unreachable");
    expect(out.data).toEqual({
      company_id: CID,
      url: `https://www.qollie.com/companies/${CID}`,
      good: 3,
      normal: 14,
      bad: 4,
      total: 42,
      experienced: 21,
      question: 5,
      chat: 16,
    });
    expect("reviews" in out).toBe(false);
    expect(queries(fakeHttp).some((q) => q.includes("searchComments"))).toBe(false);
  });

  it("test_matches_by_tax_id_not_first_row", async () => {
    const search = {
      data: {
        searchCompanies: [
          { _id: "x1", name: "不相干", taxId: "11111111" },
          { _id: CID, name: "台積電", taxId: "22099131" },
        ],
      },
    };
    route(fakeHttp, { search });
    const out = await qollie.get("台灣積體電路製造股份有限公司", "22099131", { includeReviews: false });
    if (out.status !== "ok") throw new Error("unreachable");
    expect(out.data.company_id).toBe(CID);
  });

  it("test_no_matching_tax_id_is_not_found", async () => {
    route(fakeHttp, { search: { data: { searchCompanies: [{ _id: "x1", name: "不相干", taxId: "11111111" }] } } });
    expect(await qollie.get("某公司", "22099131")).toEqual({ status: "not_found" });
    expect(queries(fakeHttp).some((q) => q.includes("getCompanyStat"))).toBe(false);
  });

  it("test_empty_search_is_not_found", async () => {
    route(fakeHttp, { search: { data: { searchCompanies: [] } } });
    expect(await qollie.get("某公司", "22099131")).toEqual({ status: "not_found" });
  });

  it("test_graphql_errors_are_schema_error", async () => {
    fakeHttp.add(URL, new FakeResponse({ jsonData: { errors: [{ message: "boom" }] } }));
    await expect(qollie.get("某公司", "22099131")).rejects.toSatisfy(
      (e: unknown) => e instanceof SourceError && e.type === "schema",
    );
  });

  it("test_reviews_sorted_newest_first_and_limited", async () => {
    route(fakeHttp);
    const out = await qollie.get("台灣積體電路製造股份有限公司", "22099131", { reviewLimit: 2 });
    if (out.status !== "ok" || !out.reviews) throw new Error("unreachable");
    const items = out.reviews.items;
    expect(items.map((i) => i.posted)).toEqual(["2024-08-26", "2021-07-02"]);
    expect(out.reviews.notice).toContain("第三方");
    expect(Object.keys(items[0]).sort()).toEqual([
      "category",
      "cons",
      "content",
      "judge",
      "posted",
      "pros",
      "source",
      "url",
    ]);
    expect(items[0].source).toBe("qollie");
    expect(items[0].pros).toBeTruthy();
    expect(items[0].cons).toBeTruthy();
  });

  it("test_comment_query_fetches_fifty_for_local_sort", async () => {
    route(fakeHttp);
    await qollie.get("台灣積體電路製造股份有限公司", "22099131", { reviewLimit: 3 });
    const call = fakeHttp.calls.find((c) => (c.json as { query: string }).query.includes("searchComments"));
    expect(call).toBeDefined();
    const qBody = call!.json as { query: string; variables?: Record<string, unknown> };
    expect(/limit:\s*50/.test(qBody.query) || qBody.variables?.limit === 50).toBe(true);
  });

  it.each([true, false])("test_queries_never_ask_for_identity_fields (%s)", async (flag) => {
    route(fakeHttp);
    await qollie.get("台灣積體電路製造股份有限公司", "22099131", { includeReviews: flag });
    for (const q of queries(fakeHttp)) {
      expect(/\b(ip|IP|user|author|nickname|email|userId)\b/.test(q)).toBe(false);
    }
  });

  it("test_ip_and_author_fields_never_reach_output", async () => {
    const comments = structuredClone(loadCompany<Record<string, any>>("qollie_comments.json"));
    for (const c of comments.data.searchComments) {
      Object.assign(c, { ip: "203.0.113.7", author: "王小明", user: { name: "某人" }, likesCount: 9 });
    }
    route(fakeHttp, { comments });
    const out = await qollie.get("台灣積體電路製造股份有限公司", "22099131");
    const dumped = JSON.stringify(out);
    expect(dumped).not.toContain("203.0.113.7");
    expect(dumped).not.toContain("王小明");
    expect(dumped).not.toContain("某人");
    expect(dumped).not.toContain("likesCount");
  });

  it("test_long_text_clipped", async () => {
    const comments = structuredClone(loadCompany<Record<string, any>>("qollie_comments.json"));
    comments.data.searchComments[0].content = "字".repeat(2000);
    comments.data.searchComments[0].pros = "好".repeat(2000);
    route(fakeHttp, { comments });
    const out = await qollie.get("台灣積體電路製造股份有限公司", "22099131");
    if (out.status !== "ok" || !out.reviews) throw new Error("unreachable");
    for (const it of out.reviews.items) {
      for (const k of ["content", "pros", "cons"] as const) {
        const val = it[k];
        expect(val === null || val.length <= 601).toBe(true);
      }
    }
  });
});
