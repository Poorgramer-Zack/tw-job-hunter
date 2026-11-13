import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as common from "../../src/company/common.js";
import * as goodjob from "../../src/company/goodjob.js";
import * as http from "../../src/company/http.js";
import { SourceError } from "../../src/company/http.js";
import { FakeHTTP, FakeResponse, loadCompany } from "./helpers.js";

const API = "api.goodjob.life";
const FORBIDDEN = [
  "gender",
  "education",
  "sector",
  "jobLevel",
  "author",
  "nickname",
  "userId",
  "email",
  "salary{",
];

function served(fakeHttp: FakeHTTP, payload?: unknown) {
  fakeHttp.add(API, new FakeResponse({ jsonData: payload ?? loadCompany("goodjob_taxid_22099131.json") }));
}

function sentQuery(fakeHttp: FakeHTTP): string {
  return (fakeHttp.calls[0].json as { query: string }).query;
}

describe("company/goodjob", () => {
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

  it("test_stats_and_link", async () => {
    served(fakeHttp);
    const out = await goodjob.get("22099131", { includeReviews: false });
    expect(out.status).toBe("ok");
    if (out.status !== "ok") throw new Error("unreachable");
    const d = out.data;
    expect(d.tax_id).toBe("22099131");
    expect(d.name?.startsWith("台灣積體電路製造股份有限公司")).toBe(true);
    expect(d.url).toBe("https://www.goodjob.life/companies/" + common.quoteStrict(d.name ?? ""));
    expect(d.data_count).toBe(5096);
    expect(d.experience_count).toBe(3940);
    expect(d.salary_work_time_count).toBe(1156);
    expect(d.rating?.average).toBeCloseTo(3.877, 3);
    expect(d.rating?.count).toBe(3819);
    expect(d.avg_week_work_time).toBeCloseTo(52.03, 2);
    expect(d.avg_hourly_wage).toBeCloseTo(519.56, 2);
    expect(Object.keys(d.overtime_frequency ?? {}).sort()).toEqual([
      "almost_everyday",
      "seldom",
      "sometimes",
      "usually",
    ]);
    expect(d.aspect_ratings.length).toBeGreaterThan(0);
    expect(Object.keys(d.aspect_ratings[0]).sort()).toEqual(["aspect", "average", "count"]);
    expect(d.top_job_titles.length).toBeGreaterThan(0);
  });

  it("test_only_matching_business_number_is_used", async () => {
    served(fakeHttp, loadCompany("goodjob_not_found.json"));
    expect(await goodjob.get("00000000")).toEqual({ status: "not_found" });
  });

  it("test_graphql_errors_are_schema_error", async () => {
    fakeHttp.add(API, new FakeResponse({ jsonData: { errors: [{ message: "Cannot query field x" }] } }));
    await expect(goodjob.get("22099131")).rejects.toSatisfy(
      (e: unknown) => e instanceof SourceError && e.type === "schema",
    );
  });

  it("test_missing_data_is_schema_error", async () => {
    fakeHttp.add(API, new FakeResponse({ jsonData: { data: {} } }));
    await expect(goodjob.get("22099131")).rejects.toSatisfy(
      (e: unknown) => e instanceof SourceError && e.type === "schema",
    );
  });

  it("test_company_without_data_has_nulls", async () => {
    const payload = structuredClone(loadCompany<Record<string, any>>("goodjob_taxid_22099131.json"));
    const c = payload.data.search_companies[0];
    c.companyRatingStatistics = null;
    c.salary_work_time_statistics = null;
    c.companyAspectRatingStatistics = null;
    c.topNJobTitles = null;
    served(fakeHttp, payload);
    const out = await goodjob.get("22099131", { includeReviews: false });
    if (out.status !== "ok") throw new Error("unreachable");
    const d = out.data;
    expect(d.rating).toBeNull();
    expect(d.avg_week_work_time).toBeNull();
    expect(d.aspect_ratings).toEqual([]);
    expect(d.top_job_titles).toEqual([]);
  });

  it("test_reviews_default_on_with_limit_variable", async () => {
    served(fakeHttp);
    const out = await goodjob.get("22099131", { reviewLimit: 7 });
    expect((fakeHttp.calls[0].json as { variables: unknown }).variables).toEqual({ q: "22099131", n: 7 });
    if (out.status !== "ok" || !out.reviews) throw new Error("unreachable");
    const r = out.reviews;
    expect(r.notice).toContain("第三方");
    expect(r.interview_total).toBe(3544);
    expect(r.work_total).toBeGreaterThan(0);
    const iv = r.interviews[0];
    expect(Object.keys(iv).sort()).toEqual([
      "experience_years",
      "interview_date",
      "job_title",
      "posted",
      "rating",
      "region",
      "result",
      "sections",
      "source",
      "url",
    ]);
    expect(iv.source).toBe("goodjob");
    expect(iv.interview_date).toBe("2026-11");
    expect(iv.posted).toBe("2026-11-11");
    expect(iv.sections[0].title).toBeTruthy();
    expect(iv.sections[0].content).toBeTruthy();
    const wk = r.work[0];
    expect("week_work_time" in wk).toBe(true);
    expect("recommend" in wk).toBe(true);
  });

  it("test_review_limit_applied_even_if_server_returns_more", async () => {
    served(fakeHttp);
    const out = await goodjob.get("22099131", { reviewLimit: 1 });
    if (out.status !== "ok" || !out.reviews) throw new Error("unreachable");
    expect(out.reviews.interviews).toHaveLength(1);
    expect(out.reviews.work).toHaveLength(1);
  });

  it("test_reviews_off_sends_no_review_fields", async () => {
    served(fakeHttp);
    const out = await goodjob.get("22099131", { includeReviews: false });
    const q = sentQuery(fakeHttp);
    expect(q).not.toContain("interviewExperiences");
    expect(q).not.toContain("workExperiences");
    expect(q).not.toContain("$n");
    expect("reviews" in out).toBe(false);
    expect((fakeHttp.calls[0].json as { variables: unknown }).variables).toEqual({ q: "22099131" });
  });

  it.each([true, false])("test_query_never_contains_personal_fields (%s)", async (flag) => {
    served(fakeHttp);
    await goodjob.get("22099131", { includeReviews: flag });
    const q = sentQuery(fakeHttp);
    for (const word of FORBIDDEN) {
      expect(q).not.toContain(word);
    }
    expect(/\b(ip|IP)\b/.test(q)).toBe(false);
  });

  it("test_long_section_text_is_clipped", async () => {
    const payload = structuredClone(loadCompany<Record<string, any>>("goodjob_taxid_22099131.json"));
    payload.data.search_companies[0].interviewExperiencesResult.interviewExperiences[0].sections[0].content =
      "字".repeat(2000);
    served(fakeHttp, payload);
    const out = await goodjob.get("22099131");
    if (out.status !== "ok" || !out.reviews) throw new Error("unreachable");
    const c = out.reviews.interviews[0].sections[0].content ?? "";
    expect(c.length).toBeGreaterThanOrEqual(600);
    expect(c.length).toBeLessThanOrEqual(601);
    expect(c.endsWith("…")).toBe(true);
  });

  it("test_unknown_extra_fields_are_dropped", async () => {
    const payload = structuredClone(loadCompany<Record<string, any>>("goodjob_taxid_22099131.json"));
    const e = payload.data.search_companies[0].interviewExperiencesResult.interviewExperiences[0];
    Object.assign(e, { gender: "male", education: "碩士", author: "王小明", ip: "1.2.3.4" });
    served(fakeHttp, payload);
    const out = await goodjob.get("22099131");
    if (out.status !== "ok" || !out.reviews) throw new Error("unreachable");
    const dumped = JSON.stringify(out.reviews.interviews[0]);
    expect(dumped).not.toContain("male");
    expect(dumped).not.toContain("王小明");
    expect(dumped).not.toContain("1.2.3.4");
    expect(dumped).not.toContain("碩士");
  });
});
