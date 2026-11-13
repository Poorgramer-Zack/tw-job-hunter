import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Schema104Error } from "../../src/job104/client.js";
import * as detail from "../../src/job104/detail.js";
import { fakeResponse, installFakeFetch, loadFixture, resetJob104State } from "./helpers.js";

beforeEach(() => {
  resetJob104State();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("job104 detail", () => {
  it.each([
    "8u9za",
    " 8u9za ",
    "https://www.104.com.tw/job/8u9za",
    "https://www.104.com.tw/job/8u9za?jobsource=x",
    "www.104.com.tw/job/8u9za/",
  ])("test_parse_job_code %s", (text) => {
    expect(detail.parseJobCode(text)).toBe("8u9za");
  });

  it.each(["", "hello world", "https://www.104.com.tw/company/abc", "8U9ZA!"])(
    "test_parse_job_code_invalid %s",
    (text) => {
      expect(() => detail.parseJobCode(text)).toThrow("職缺代碼");
    },
  );

  it("test_normalize_fixture", () => {
    const d = detail.normalize(loadFixture("detail.json"), "8zf18");
    expect(d.status).toBe("open");
    expect(d.job_code).toBe("8zf18");
    expect(d.title).toBe("Application Engineers");
    expect(d.company).toBe("美商_國家儀器股份有限公司");
    expect(d.salary).toBe("待遇面議");
    expect(d.salary_min).toBe(0);
    expect(d.categories[0]).toBe("軟體工程師");
    expect(d.address).toBe("新竹市自强路8号");
    expect(d.remote).toBe("none");
    expect(d.openings).toBe("1人");
    expect(d.requirements.experience).toBe("5年以上");
    expect(d.requirements.education).toBe("大學以上");
    expect(d.requirements.tools).toContain("LabVIEW");
    expect(d.welfare.text?.startsWith("【保障員工福利】")).toBe(true);
    expect(d.url).toBe("https://www.104.com.tw/job/8zf18");
    expect(d.description).toBeTruthy();
  });

  it("test_missing_optional_fields_are_null", () => {
    const d = detail.normalize({ data: { jobDetail: {} } }, "abcd");
    expect(d.title).toBeNull();
    expect(d.requirements.experience).toBeNull();
    expect(d.welfare.text).toBeNull();
    expect(d.remote).toBe("none");
    expect(d.address).toBeNull();
  });

  it("test_schema_changed", () => {
    expect(() => detail.normalize({ data: { header: {} } }, "abcd")).toThrow(Schema104Error);
  });

  it("test_closed_job", async () => {
    installFakeFetch(
      fakeResponse({
        status: 404,
        jsonData: { error: { code: 11201, message: "職務不存在" } },
      }),
    );
    await expect(detail.detail("zzzzz")).resolves.toEqual({
      job_code: "zzzzz",
      status: "not_found",
      message: "職缺不存在或已關閉",
    });
  });

  it("test_detail_end_to_end", async () => {
    const calls = installFakeFetch(fakeResponse({ jsonData: loadFixture("detail.json") }));
    const out = await detail.detail("https://www.104.com.tw/job/8zf18?x=1");
    expect(calls[0].url).toBe("https://www.104.com.tw/job/ajax/content/8zf18");
    expect(calls[0].headers.Referer).toBe("https://www.104.com.tw/job/8zf18");
    expect(out.status).toBe("open");
  });
});
