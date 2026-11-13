import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as http from "../../src/company/http.js";
import { SourceError } from "../../src/company/http.js";
import * as interviewTw from "../../src/company/interview_tw.js";
import { FakeHTTP, FakeResponse, loadCompany } from "./helpers.js";

const AC = "auto-complete/companies";
const SECRET = "這是精選心得全文，不可以出現在輸出裡";

function serve(
  fakeHttp: FakeHTTP,
  opts: { page?: string; autocomplete?: unknown; salary?: unknown } = {},
) {
  fakeHttp.add(
    AC,
    new FakeResponse({ jsonData: opts.autocomplete ?? loadCompany("itw_autocomplete.json") }),
  );
  fakeHttp.add(
    "/c/KYRX/salary-average",
    new FakeResponse({ jsonData: opts.salary ?? loadCompany("itw_salary_average.json") }),
  );
  fakeHttp.add(
    "/c/KYRX",
    new FakeResponse({ body: opts.page ?? loadCompany<string>("itw_company.html") }),
  );
}

describe("company/interview_tw", () => {
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

  it("test_summary_numbers_and_links", async () => {
    serve(fakeHttp);
    const out = await interviewTw.get("台灣積體電路製造股份有限公司", "22099131");
    expect(out.status).toBe("ok");
    if (out.status !== "ok") throw new Error("unreachable");
    const d = out.data;
    expect(d.short_id).toBe("KYRX");
    expect(d.url).toBe("https://interview.tw/c/KYRX");
    expect(d.salary_url).toBe("https://salary.tw/c/KYRX");
    expect(d.interview_count).toBe("4714");
    expect(d.rating).toBe("3.9/5");
    expect(d.offer_rate).toBe("48%");
    expect(d.difficulty).toBe("低");
    expect(d.avg_monthly_salary).toBe("53k");
    expect(d.salary_reports).toBe("2082");
    expect(d.review_count).toBe(4714);
    expect(d.rating_value).toBe(3.9);
    expect(fakeHttp.calls.some((c) => c.url.includes("salary-average"))).toBe(false);
  });

  it("test_autocomplete_matched_by_code", async () => {
    const ac = {
      source: [
        { id: "a", name: "別家", shortId: "ZZZZ", score: 1, code: "11111111" },
        { id: "b", name: "台積電_台灣積體電路製造股份有限公司", shortId: "KYRX", score: 4714, code: "22099131" },
      ],
    };
    serve(fakeHttp, { autocomplete: ac });
    const out = await interviewTw.get("台灣積體電路製造股份有限公司", "22099131");
    if (out.status !== "ok") throw new Error("unreachable");
    expect(out.data.short_id).toBe("KYRX");
  });

  it.each([
    [[]],
    [[{ id: "a", name: "外商", shortId: "ZZZZ", score: 3, code: null }]],
    [[{ id: "a", name: "別家", shortId: "ZZZZ", score: 1, code: "11111111" }]],
  ])("test_no_code_match_is_not_found %j", async (source) => {
    serve(fakeHttp, { autocomplete: { source } });
    const out = await interviewTw.get("某公司", "22099131");
    expect(out).toEqual({ status: "not_found" });
    expect(fakeHttp.calls.some((c) => c.url.includes("/c/"))).toBe(false);
  });

  it("test_dash_salary_fetches_salary_average", async () => {
    const page = loadCompany<string>("itw_company.html").replace(">53k<", ">-<");
    serve(fakeHttp, { page });
    const out = await interviewTw.get("台灣積體電路製造股份有限公司", "22099131");
    if (out.status !== "ok") throw new Error("unreachable");
    const expectedDisplay = loadCompany<{ display: string }>("itw_salary_average.json").display;
    expect(out.data.avg_monthly_salary).toBe(expectedDisplay);
    expect(fakeHttp.calls.some((c) => c.url.includes("salary-average"))).toBe(true);
  });

  it("test_no_review_text_in_output", async () => {
    const page = loadCompany<string>("itw_company.html").replace(
      "</body>",
      `<div class="iw_interview-card"><p>${SECRET}</p></div></body>`,
    );
    serve(fakeHttp, { page });
    const out = await interviewTw.get("台灣積體電路製造股份有限公司", "22099131");
    expect(JSON.stringify(out)).not.toContain(SECRET);
  });

  it("test_page_without_stats_is_schema_error", async () => {
    serve(fakeHttp, { page: "<html><body>maintenance</body></html>" });
    await expect(interviewTw.get("台灣積體電路製造股份有限公司", "22099131")).rejects.toSatisfy(
      (e: unknown) => e instanceof SourceError && e.type === "schema",
    );
  });

  it("test_never_requests_disallowed_paths", async () => {
    serve(fakeHttp);
    await interviewTw.get("台灣積體電路製造股份有限公司", "22099131");
    for (const c of fakeHttp.calls) {
      expect(c.url).not.toContain("/search");
      expect(c.url).not.toContain("/auth/");
      expect(c.url).not.toContain("/interviews");
      for (const forbidden of ["sort", "position", "area"]) {
        expect(forbidden in c.params).toBe(false);
      }
    }
  });

  it("test_autocomplete_uses_json_headers_and_short_name", async () => {
    serve(fakeHttp);
    await interviewTw.get("台灣積體電路製造股份有限公司", "22099131");
    const c = fakeHttp.calls[0];
    expect(c.params.search).toBe("台灣積體電路製造");
    expect(c.headers["x-requested-with"]).toBe("XMLHttpRequest");
  });
});
