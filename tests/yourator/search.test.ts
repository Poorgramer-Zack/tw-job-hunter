import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SourceError } from "../../src/company/http.js";
import * as search from "../../src/yourator/search.js";
import {
  FakeHTTP,
  FakeResponse,
  installOfflineYouratorCodes,
  loadYouratorJson,
  resetYouratorState,
} from "./helpers.js";

describe("yourator search", () => {
  beforeEach(() => {
    resetYouratorState();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("test_build_query_minimal", async () => {
    installOfflineYouratorCodes();
    const pairs = await search.buildQueryPairs({ keyword: "python" });
    expect(pairs).toEqual([
      ["term[]", "python"],
      ["sort", "most_related"],
      ["page", "1"],
    ]);
  });

  it("test_build_query_full", async () => {
    installOfflineYouratorCodes();
    const pairs = await search.buildQueryPairs({
      keyword: "python",
      page: 2,
      areas: ["台北市", "新北市"],
      job_categories: ["前端工程", "後端工程"],
      remote: "full",
      salary_min: 60000,
      salary_type: "monthly",
      job_type: "intern",
      order: "newest",
    });
    expect(pairs).toEqual([
      ["term[]", "python"],
      ["area[]", "TPE"],
      ["area[]", "NWT"],
      ["category[]", "前端工程"],
      ["category[]", "後端工程"],
      ["remote_work[]", "full"],
      ["monthly", "60000,10000000"],
      ["position[]", "intern"],
      ["sort", "recent_updated"],
      ["page", "2"],
    ]);
  });

  it("test_remote_any_sends_both_full_and_partial", async () => {
    installOfflineYouratorCodes();
    const pairs = await search.buildQueryPairs({ keyword: "python", remote: "any" });
    expect(pairs.filter(([k]) => k === "remote_work[]")).toEqual([
      ["remote_work[]", "full"],
      ["remote_work[]", "partial"],
    ]);
  });

  it("test_remote_partial", async () => {
    installOfflineYouratorCodes();
    const pairs = await search.buildQueryPairs({ keyword: "python", remote: "partial" });
    expect(pairs.filter(([k]) => k === "remote_work[]")).toEqual([["remote_work[]", "partial"]]);
  });

  it("test_yearly_salary_ceil_to_monthly", async () => {
    installOfflineYouratorCodes();
    const p1 = await search.buildQueryPairs({
      keyword: "x",
      salary_min: 1200000,
      salary_type: "yearly",
    });
    expect(p1).toContainEqual(["monthly", "100000,10000000"]);

    const p2 = await search.buildQueryPairs({
      keyword: "x",
      salary_min: 1000000,
      salary_type: "yearly",
    });
    // ceil(1000000 / 12) = 83334
    expect(p2).toContainEqual(["monthly", "83334,10000000"]);
  });

  it.each(["full_time", "part_time", "contract", "temporary", "intern"] as const)(
    "test_job_type_values %s",
    async (jobType) => {
      installOfflineYouratorCodes();
      const pairs = await search.buildQueryPairs({ keyword: "x", job_type: jobType });
      expect(pairs).toContainEqual(["position[]", jobType]);
    },
  );

  it.each<[Record<string, unknown>, string]>([
    [{ keyword: "" }, "keyword"],
    [{ keyword: "  " }, "keyword"],
    [{ keyword: "x", page: 0 }, "page"],
    [{ keyword: "x", page: -1 }, "page"],
    [{ keyword: "x", page: 1.5 }, "page"],
    [{ keyword: "x", remote: "hybrid" }, "remote 只接受：full, partial, any"],
    [{ keyword: "x", salary_min: 0 }, "salary_min"],
    [{ keyword: "x", salary_min: -500 }, "salary_min"],
    [{ keyword: "x", salary_min: 1.5 }, "salary_min"],
    [{ keyword: "x", salary_min: 60000, salary_type: "daily" }, "salary_type 只接受：monthly, yearly"],
    [
      { keyword: "x", job_type: "freelance" },
      "job_type 只接受：full_time, part_time, contract, temporary, intern",
    ],
    [{ keyword: "x", order: "salary" }, "order 只接受：relevance, newest"],
  ])("test_rejects_invalid_input_without_request %o", async (opts, expectedMsg) => {
    const fh = new FakeHTTP();
    fh.install();
    await expect(search.youratorSearch(opts as unknown as search.YouratorSearchOptions)).rejects.toThrow(
      expectedMsg,
    );
    expect(fh.calls).toHaveLength(0);
  });

  it("test_rejects_unknown_area_without_search_request", async () => {
    const fh = installOfflineYouratorCodes();
    await expect(search.youratorSearch({ keyword: "python", areas: ["火星"] })).rejects.toThrow(
      "無法辨識的地區",
    );
    expect(fh.calls.some((c) => c.url.includes("/api/v4/jobs"))).toBe(false);
  });

  it("test_rejects_unknown_or_ambiguous_category_without_search_request", async () => {
    const fh = installOfflineYouratorCodes();
    await expect(
      search.youratorSearch({ keyword: "python", job_categories: ["工程師"] }),
    ).rejects.toThrow("多個符合");
    expect(fh.calls.some((c) => c.url.includes("/api/v4/jobs"))).toBe(false);
  });

  it.each<[string, number | null, number | null, string | null]>([
    ["NT$ 35,000 - 55,000 (月薪)", 35000, 55000, "monthly"],
    ["NT$ 85,000 -  (月薪)", 85000, null, "monthly"],
    ["NT$ 1,000,000 - 1,700,000 (年薪)", 1000000, 1700000, "yearly"],
    ["NT$ 300 - 300 (時薪)", 300, 300, "hourly"],
    ["NT$ 50,000 以上 (月薪)", 50000, null, "monthly"],
    ["面議（經常性薪資達4萬元）", null, null, null],
  ])("test_parse_salary_text %s", (raw, low, high, unit) => {
    expect(search.parseSalaryText(raw)).toEqual({
      salary_low: low,
      salary_high: high,
      salary_unit: unit,
    });
  });

  it("test_normalize_fixture_shape_and_no_total_no_description", () => {
    const fixture = loadYouratorJson("list_keyword.json");
    const out = search.normalize(fixture, 1);

    expect(out.page).toBe(1);
    expect(out.has_more).toBe(true);
    expect("total" in out).toBe(false);
    expect("last_page" in out).toBe(false);
    expect(out.jobs).toHaveLength(20);

    const first = out.jobs[0];
    expect(first).toEqual({
      job_code: "48361",
      title: "車隊路線最佳化軟體工程師（Python / OR-Tools / GIS）",
      company: "RideFair 睿德菲爾有限公司",
      company_path: "/companies/ridefair",
      area: "高雄市",
      salary: "NT$ 85,000 -  (月薪)",
      salary_low: 85000,
      salary_high: null,
      salary_unit: "monthly",
      url: "https://www.yourator.co/companies/ridefair/jobs/48361",
      updated_text: "一天內更新",
      tags: [],
    });

    for (const j of out.jobs) {
      expect("description" in j).toBe(false);
      expect("content" in j).toBe(false);
      expect("requirements" in j).toBe(false);
      expect("benefits" in j).toBe(false);
    }
  });

  it("test_empty_result_fixture", async () => {
    const fh = new FakeHTTP();
    fh.add("/api/v4/jobs", new FakeResponse({ jsonData: loadYouratorJson("list_empty.json") }));
    fh.install();

    const out = await search.youratorSearch({ keyword: "zzzznonexistent" });
    expect(out).toEqual({ page: 1, has_more: false, jobs: [] });
  });

  it("test_salary_min_filters_out_negotiable_rows", async () => {
    const fh = new FakeHTTP();
    fh.add(
      "/api/v4/jobs",
      new FakeResponse({
        jsonData: {
          payload: {
            hasMore: false,
            currentPage: 1,
            jobs: [
              {
                id: 1,
                name: "Senior Eng",
                path: "/companies/a/jobs/1",
                salary: "NT$ 70,000 - 90,000 (月薪)",
                lastActiveAt: "一天內更新",
                location: "臺北市",
                tags: [],
                company: { brand: "A", path: "/companies/a" },
              },
              {
                id: 2,
                name: "Negotiable Role",
                path: "/companies/b/jobs/2",
                salary: "面議（經常性薪資達4萬元）",
                lastActiveAt: "一天內更新",
                location: "臺北市",
                tags: [],
                company: { brand: "B", path: "/companies/b" },
              },
            ],
          },
        },
      }),
    );
    fh.install();

    const out = await search.youratorSearch({ keyword: "python", salary_min: 60000 });
    expect(out.jobs).toHaveLength(1);
    expect(out.jobs[0].job_code).toBe("1");
  });

  it("test_schema_error_when_payload_jobs_missing", async () => {
    const fh = new FakeHTTP();
    fh.add("/api/v4/jobs", new FakeResponse({ jsonData: { payload: { hasMore: false } } }));
    fh.install();

    await expect(search.youratorSearch({ keyword: "python" })).rejects.toSatisfy(
      (e: unknown) => e instanceof SourceError && e.type === "schema",
    );
  });

  it("test_search_sends_anonymous_get_with_referer_and_multi_params", async () => {
    const fh = new FakeHTTP();
    fh.add("/api/v4/jobs", new FakeResponse({ jsonData: loadYouratorJson("list_keyword.json") }));
    installOfflineYouratorCodes(fh);

    await search.youratorSearch({
      keyword: "python",
      page: 2,
      areas: ["台北市", "新北市"],
      remote: "any",
    });

    const jobCall = fh.calls.find((c) => c.url.includes("/api/v4/jobs"))!;
    expect(jobCall.method).toBe("GET");
    expect(jobCall.headers["cookie"]).toBeUndefined();
    expect(jobCall.headers["referer"]).toBe("https://www.yourator.co/jobs");
    expect(jobCall.headers["x-requested-with"]).toBe("XMLHttpRequest");

    const sp = new URL(jobCall.url).searchParams;
    expect(sp.getAll("term[]")).toEqual(["python"]);
    expect(sp.getAll("area[]")).toEqual(["TPE", "NWT"]);
    expect(sp.getAll("remote_work[]")).toEqual(["full", "partial"]);
    expect(sp.get("page")).toBe("2");
  });

  it("test_remote_full_and_partial_fixtures_normalize", () => {
    const full = search.normalize(loadYouratorJson("list_remote_full.json"), 1);
    const partial = search.normalize(loadYouratorJson("list_remote_partial.json"), 1);
    expect(full.jobs.length).toBeGreaterThan(0);
    expect(partial.jobs.length).toBeGreaterThan(0);
  });
});
