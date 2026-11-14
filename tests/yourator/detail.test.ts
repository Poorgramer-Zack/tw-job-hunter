import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SourceError } from "../../src/company/http.js";
import * as detail from "../../src/yourator/detail.js";
import {
  FakeHTTP,
  FakeResponse,
  loadYouratorFixture,
  resetYouratorState,
} from "./helpers.js";

describe("yourator detail", () => {
  beforeEach(() => {
    resetYouratorState();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each([
    [
      "https://www.yourator.co/companies/ridefair/jobs/47902",
      "https://www.yourator.co/companies/ridefair/jobs/47902",
      "47902",
    ],
    [
      "https://yourator.co/companies/ridefair/jobs/47902?utm_source=test",
      "https://www.yourator.co/companies/ridefair/jobs/47902",
      "47902",
    ],
    [
      "/companies/english-cool/jobs/38961",
      "https://www.yourator.co/companies/english-cool/jobs/38961",
      "38961",
    ],
    [
      " /companies/flexii/jobs/48504/ ",
      "https://www.yourator.co/companies/flexii/jobs/48504",
      "48504",
    ],
  ])("test_parse_job_url_valid %s", (input, expectedUrl, expectedCode) => {
    const parsed = detail.parseJobUrl(input);
    expect(parsed.url).toBe(expectedUrl);
    expect(parsed.jobCode).toBe(expectedCode);
  });

  it.each([
    "",
    "   ",
    "https://www.104.com.tw/job/8u9za",
    "https://evil.com/companies/foo/jobs/123",
    "https://www.yourator.co/jobs/47902",
    "https://www.yourator.co/r/redirect",
    "/r/something",
    "47902",
    "https://www.yourator.co/companies/ridefair",
  ])("test_parse_job_url_rejects_without_request %s", async (badInput) => {
    const fh = new FakeHTTP();
    fh.install();
    await expect(detail.youratorJobDetail(badInput)).rejects.toThrow();
    expect(fh.calls).toHaveLength(0);
  });

  it("test_parse_ordinary_fixture", () => {
    const html = loadYouratorFixture("detail_ordinary.html");
    const res = detail.parseDetailHtml(
      html,
      "https://www.yourator.co/companies/ridefair/jobs/47902",
      "47902",
    );

    expect(res.status).toBe("ok");
    expect(res.job_code).toBe("47902");
    expect(res.title).toContain("初階軟體工程師");
    expect(res.company).toBe("RideFair 睿德菲爾有限公司");
    expect(res.company_legal_name).toBe("睿德菲爾有限公司");
    expect(res.employment_type).toBe("PART_TIME");
    expect(res.posted).toBe("2026-11-13 02:00:07 +0800");
    expect(res.valid_until).toBeNull(); // 2112-09-03 -> null
    expect(res.location).toBe("高雄市成功二路25號8樓");
    expect(res.salary).toBe("NT$ 300 - 300 (時薪)");
    expect(res.salary_low).toBe(300);
    expect(res.salary_high).toBe(300);
    expect(res.salary_unit).toBe("hourly");
    expect(res.work_content).toContain("GPS 資料清理");
    expect(res.requirements).toContain("Python 經驗");
    expect(res.nice_to_have).toContain("OR-Tools");
    // 福利同時包含法定項目與其他福利
    expect(res.benefits).toContain("法定項目");
    expect(res.benefits).toContain("勞保、健保");
    expect(res.benefits).toContain("其他福利");
    expect(res.benefits).toContain("週休二日");
    // 只有遠端面試，沒有遠端工作
    expect(res.remote_work).toEqual({ value: "none", text: null });
    expect(res.remote_interview.value).toBe("partial");
    expect(res.remote_interview.text).toContain("部分遠端面試");
    expect(res.tags).toEqual([]);
    expect(res.url).toBe("https://www.yourator.co/companies/ridefair/jobs/47902");
    expect("tax_id" in res).toBe(false);
    expect("user" in res).toBe(false);
  });

  it("test_parse_remote_full_fixture", () => {
    const html = loadYouratorFixture("detail_remote_full.html");
    const res = detail.parseDetailHtml(
      html,
      "https://www.yourator.co/companies/english-cool/jobs/38961",
      "38961",
    );

    expect(res.company_legal_name).toBe("英文庫有限公司");
    expect(res.employment_type).toBe("CONTRACTOR");
    expect(res.location).toBeNull();
    expect(res.remote_work.value).toBe("full");
    expect(res.remote_work.text).toContain("完全遠端工作");
    expect(res.remote_interview.value).toBe("full");
    expect(res.remote_interview.text).toContain("完全遠端面試");
    expect(res.tags).toEqual(["UI/UX", "UIUX", "UI/UX工程師", "UI/UX designer"]);
    expect(res.benefits).toBeNull();
  });

  it("test_parse_remote_partial_fixture_preserves_list_line_breaks", () => {
    const html = loadYouratorFixture("detail_remote_partial.html");
    const res = detail.parseDetailHtml(
      html,
      "https://www.yourator.co/companies/flexii/jobs/48504",
      "48504",
    );

    expect(res.salary_low).toBe(50000);
    expect(res.salary_high).toBe(80000);
    expect(res.salary_unit).toBe("monthly");
    expect(res.remote_work).toEqual({ value: "partial", text: "部分遠端工作" });
    expect(res.remote_interview).toEqual({ value: "partial", text: "部分遠端面試" });
    expect(res.tags).toEqual(["customer success"]);
    // <ul><li> 清單必須保留換行
    expect(res.requirements).toContain("\n");
    const lines = res.requirements!.split("\n");
    expect(lines.some((l) => l.includes("5+ years"))).toBe(true);
    expect(lines.some((l) => l.includes("Experience managing"))).toBe(true);
  });

  it("test_synthesized_no_nice_to_have_and_normal_valid_through", () => {
    const html = `<!doctype html><html><head>
      <script type="application/ld+json">${JSON.stringify({
        "@type": "JobPosting",
        title: "Backend Eng",
        identifier: { name: "測試股份有限公司", value: 999 },
        datePosted: "2026-11-10",
        validThrough: "2026-12-31",
        employmentType: "FULL_TIME",
        hiringOrganization: { name: "TestBrand" },
      })}</script>
    </head><body>
      <div><h2 class="job-heading">工作內容</h2><section>開發 API</section></div>
      <div><h2 class="job-heading">條件要求</h2><section>熟悉 Node.js</section></div>
    </body></html>`;

    const res = detail.parseDetailHtml(
      html,
      "https://www.yourator.co/companies/test/jobs/999",
      "999",
    );
    expect(res.valid_until).toBe("2026-12-31");
    expect(res.nice_to_have).toBeNull();
    expect(res.benefits).toBeNull();
    expect(res.salary).toBeNull();
    expect(res.salary_low).toBeNull();
    expect(res.remote_work).toEqual({ value: "none", text: null });
    expect(res.remote_interview).toEqual({ value: "none", text: null });
  });

  it("test_synthesized_unknown_remote_wording_preserved", () => {
    const html = `<!doctype html><html><head>
      <script type="application/ld+json">${JSON.stringify({
        "@type": "JobPosting",
        title: "Eng",
        identifier: { name: "測試公司", value: 100 },
      })}</script>
    </head><body>
      <div><h2 class="job-heading">工作內容</h2><section>寫程式</section></div>
      <div><h2 class="job-heading">遠端型態</h2>
        <section>
          <div class="remote-content"><strong>視專案彈性遠端工作</strong></div>
          <div class="remote-content"><strong>初試線上面試複試實體</strong></div>
        </section>
      </div>
    </body></html>`;

    const res = detail.parseDetailHtml(
      html,
      "https://www.yourator.co/companies/test/jobs/100",
      "100",
    );
    expect(res.remote_work).toEqual({ value: "unknown", text: "視專案彈性遠端工作" });
    expect(res.remote_interview).toEqual({ value: "unknown", text: "初試線上面試複試實體" });
  });

  it("test_degrades_to_jsonld_description_when_no_dom_blocks", () => {
    const html = `<!doctype html><html><head>
      <script type="application/ld+json">${JSON.stringify({
        "@type": "JobPosting",
        title: "Fallback Job",
        description: "<p>負責功能開發</p><ul><li>項目一</li><li>項目二</li></ul>",
        identifier: { name: "測試有限公司", value: 777 },
        datePosted: "2026-11-01",
        validThrough: "2112-01-01",
      })}</script>
    </head><body></body></html>`;

    const res = detail.parseDetailHtml(
      html,
      "https://www.yourator.co/companies/test/jobs/777",
      "777",
    );
    expect(res.work_content).toBe("負責功能開發\n項目一\n項目二");
    expect(res.requirements).toBeNull();
    expect(res.nice_to_have).toBeNull();
    expect(res.benefits).toBeNull();
    expect(res.valid_until).toBeNull();
  });

  it("test_schema_error_when_neither_jsonld_nor_dom_blocks", () => {
    const html = "<!doctype html><html><body><div>empty</div></body></html>";
    expect(() =>
      detail.parseDetailHtml(html, "https://www.yourator.co/companies/test/jobs/1", "1"),
    ).toThrow(SourceError);
    try {
      detail.parseDetailHtml(html, "https://www.yourator.co/companies/test/jobs/1", "1");
    } catch (e) {
      expect((e as SourceError).type).toBe("schema");
    }
  });

  it("test_ignores_embedded_user_json_blob", () => {
    const html = `<!doctype html><html><head>
      <script type="application/ld+json">${JSON.stringify({
        "@type": "JobPosting",
        title: "Eng",
        identifier: { name: "測試公司", value: 55 },
      })}</script>
      <script type="application/json">${JSON.stringify({
        user: { id: 12345, name: "王小明", email: "secret@example.com" },
        jobs: [],
      })}</script>
    </head><body>
      <div><h2 class="job-heading">工作內容</h2><section>開發系統</section></div>
    </body></html>`;

    const res = detail.parseDetailHtml(
      html,
      "https://www.yourator.co/companies/test/jobs/55",
      "55",
    );
    const serialized = JSON.stringify(res);
    expect(serialized).not.toContain("王小明");
    expect(serialized).not.toContain("secret@example.com");
    expect("user" in res).toBe(false);
    expect("tax_id" in res).toBe(false);
  });

  it("test_404_returns_not_found", async () => {
    const fh = new FakeHTTP();
    fh.add("/companies/none/jobs/999999", new FakeResponse({ status: 404, body: "Not Found" }));
    fh.install();

    const res = await detail.youratorJobDetail(
      "https://www.yourator.co/companies/none/jobs/999999?ref=test",
    );
    expect(res).toEqual({
      status: "not_found",
      url: "https://www.yourator.co/companies/none/jobs/999999",
      message: "職缺不存在或已關閉",
    });
  });

  it("test_cloudflare_challenge_returns_blocked", async () => {
    const fh = new FakeHTTP();
    fh.add(
      "/companies/ridefair/jobs/47902",
      new FakeResponse({ status: 200, body: "<html><title>Just a moment...</title></html>" }),
    );
    fh.install();

    await expect(
      detail.youratorJobDetail("/companies/ridefair/jobs/47902"),
    ).rejects.toSatisfy((e: unknown) => e instanceof SourceError && e.type === "blocked");
  });

  it("test_end_to_end_anonymous_get", async () => {
    const fh = new FakeHTTP();
    fh.add(
      "/companies/ridefair/jobs/47902",
      new FakeResponse({ body: loadYouratorFixture("detail_ordinary.html") }),
    );
    fh.install();

    const res = await detail.youratorJobDetail("/companies/ridefair/jobs/47902");
    expect(res.status).toBe("ok");
    expect(fh.calls).toHaveLength(1);
    expect(fh.calls[0].method).toBe("GET");
    expect(fh.calls[0].url).toBe("https://www.yourator.co/companies/ridefair/jobs/47902");
    expect(fh.calls[0].headers["cookie"]).toBeUndefined();
  });
});
