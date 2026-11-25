import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Schema104Error } from "../../src/job104/client.js";
import * as search from "../../src/job104/search.js";
import {
  installFakeBrowser,
  installOfflineCodes,
  loadFixture,
  resetJob104State,
} from "./helpers.js";

beforeEach(() => {
  resetJob104State();
  installOfflineCodes();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("job104 search", () => {
  it("test_build_params_minimal", async () => {
    await expect(search.buildParams({ keyword: "python" })).resolves.toEqual({
      keyword: "python",
      page: 1,
      pagesize: 20,
      order: 15,
    });
  });

  it("test_build_params_full", async () => {
    const p = await search.buildParams({
      keyword: "python",
      page: 2,
      areas: ["台北市", "板橋"],
      remote: "full",
      salary_min: 60000,
      salary_type: "monthly",
      job_categories: ["軟體工程師"],
      job_type: "full_time",
      order: "newest",
    });
    expect(p).toEqual({
      keyword: "python",
      page: 2,
      pagesize: 20,
      order: 16,
      area: "6001001000,6001002003",
      remoteWork: "1",
      scmin: 60000,
      sctp: "M",
      scstrict: 1,
      jobcat: "2007001004",
      ro: 1,
    });
  });

  it("test_yearly_and_partial", async () => {
    const p = await search.buildParams({
      keyword: "x",
      remote: "partial",
      salary_min: 1000000,
      salary_type: "yearly",
      job_type: "part_time",
      order: "salary",
    });
    expect(p.remoteWork).toBe("2");
    expect(p.sctp).toBe("Y");
    expect(p.ro).toBe(2);
    expect(p.order).toBe(13);
  });

  it.each<[Record<string, unknown>, string]>([
    [{ keyword: "" }, "keyword"],
    [{ keyword: "x", page: 0 }, "page"],
    [{ keyword: "x", remote: "hybrid" }, "remote 只接受：full, partial, any"],
    [{ keyword: "x", salary_min: 0 }, "salary_min"],
    [{ keyword: "x", salary_min: 1, salary_type: "daily" }, "salary_type 只接受"],
    [{ keyword: "x", job_type: "intern" }, "job_type 只接受"],
    [{ keyword: "x", order: "hot" }, "order 只接受"],
    [{ keyword: "x", areas: ["火星"] }, "無法辨識的地區"],
  ])("test_build_params_rejects %o", async (kw, msg) => {
    await expect(search.buildParams(kw as unknown as search.SearchOptions)).rejects.toThrow(msg);
  });

  it("test_normalize_fixture", () => {
    const out = search.normalize(loadFixture("search.json"));
    expect(out.total).toBe(1001);
    expect(out.page).toBe(1);
    expect(out.last_page).toBe(150);
    expect(out.jobs).toHaveLength(22);
    const j = out.jobs[2];
    expect(j.job_code).toBe("8tgv1");
    expect(j.title).toBe("Python工程師");
    expect(j.company).toBe("指南動力有限公司");
    expect(j.area).toBe("台北市信義區");
    expect(j.salary).toBe("面議");
    expect(j.remote).toBe("none");
    expect(j.url).toBe("https://www.104.com.tw/job/8tgv1");
    expect(j.posted).toBe("20261109");
    expect(new Set(Object.keys(j))).toEqual(
      new Set([
        "job_code",
        "title",
        "company",
        "company_code",
        "area",
        "salary",
        "salary_low",
        "salary_high",
        "remote",
        "url",
        "posted",
        "summary",
      ]),
    );
    expect(out.jobs.every((x) => x.summary.length <= search.SUMMARY_LEN + 1)).toBe(true);
  });

  it("test_salary_text", () => {
    expect(search.formatSalary(0, 0)).toBe("面議");
    expect(search.formatSalary(50000, 0)).toBe("50000以上");
    expect(search.formatSalary(40000, 60000)).toBe("40000~60000");
    expect(search.formatSalary(80000, 9999999)).toBe("80000以上"); // 104 用 9999999 表示無上限
  });

  it("test_remote_mapping", () => {
    const base = { link: { job: "https://www.104.com.tw/job/abc1" } };
    expect(search.formatJob({ ...base, remoteWorkType: 1 }).remote).toBe("full");
    expect(search.formatJob({ ...base, remoteWorkType: 2 }).remote).toBe("partial");
  });

  it("test_empty_result", () => {
    const out = search.normalize({
      data: [],
      metadata: { pagination: { total: 0, currentPage: 1, lastPage: 0 } },
    });
    expect(out).toEqual({ total: 0, page: 1, last_page: 0, jobs: [] });
  });

  it("test_schema_changed", () => {
    expect(() => search.normalize({ items: [] })).toThrow(Schema104Error);
  });

  it("test_build_search_page_url", async () => {
    const params = await search.buildParams({ keyword: "python", page: 2, areas: ["台北市"] });
    const pageUrl = new URL(search.buildSearchPageUrl(params));
    expect(pageUrl.origin + pageUrl.pathname).toBe(search.SEARCH_PAGE);
    expect(pageUrl.searchParams.get("keyword")).toBe("python");
    expect(pageUrl.searchParams.get("page")).toBe("2");
    expect(pageUrl.searchParams.get("area")).toBe("6001001000");
    expect(pageUrl.searchParams.get("mode")).toBe("s");
  });

  it("test_search_end_to_end", async () => {
    vi.restoreAllMocks();
    installOfflineCodes();
    const browserHarness = installFakeBrowser({
      onGoto: async (_url, page) => {
        page.emitResponse({
          url: `${search.SEARCH_URL}?keyword=python`,
          jsonData: loadFixture("search.json"),
        });
      },
    });
    const out = await search.search({ keyword: "python" });
    expect(browserHarness.gotoUrls).toHaveLength(1);
    const navigated = new URL(browserHarness.gotoUrls[0]);
    expect(navigated.origin + navigated.pathname).toBe(search.SEARCH_PAGE);
    expect(navigated.searchParams.get("keyword")).toBe("python");
    expect(out.total).toBe(1001);
    expect(out.jobs).toHaveLength(22);
  });

  function payloadWithRemoteTypes(...remoteTypes: number[]) {
    return {
      data: remoteTypes.map((t, i) => ({
        link: { job: `https://www.104.com.tw/job/j${i}` },
        remoteWorkType: t,
      })),
      metadata: { pagination: { total: 9, currentPage: 1, lastPage: 1 } },
    };
  }

  it.each<["full" | "partial" | "any", string[]]>([
    ["full", ["full"]],
    ["partial", ["partial"]],
    ["any", ["full", "partial"]],
  ])("test_remote_filter_drops_ads %s", async (remote, expected) => {
    vi.restoreAllMocks();
    installOfflineCodes();
    const browserHarness = installFakeBrowser({
      onGoto: async (_url, page) => {
        page.emitResponse({
          url: `${search.SEARCH_URL}?keyword=python`,
          jsonData: payloadWithRemoteTypes(0, 1, 2, 0, 1),
        });
      },
    });
    const out = await search.search({ keyword: "python", remote });
    const navigated = new URL(browserHarness.gotoUrls[0]);
    expect(navigated.searchParams.get("remoteWork")).toBe(search.REMOTE[remote]);
    expect(out.jobs.length).toBeGreaterThan(0);
    expect(new Set(out.jobs.map((j) => j.remote))).toEqual(new Set(expected));
  });
});
