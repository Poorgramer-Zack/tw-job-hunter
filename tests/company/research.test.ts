import fs from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SourceError } from "../../src/company/http.js";
import * as research from "../../src/company/research.js";

const TAX = "22099131";
const NAME = "台灣積體電路製造股份有限公司";
const COMPANY = {
  status: "ok" as const,
  data: {
    tax_id: TAX,
    name: NAME,
    status: "核准設立",
    capital: 1,
    paid_in_capital: 1,
    responsible: "魏哲家",
    address: "addr",
    setup_date: "1987-02-21",
    years_since_setup: 39,
  },
};
const GOODJOB = {
  status: "ok" as const,
  data: { name: "台積電 TSMC", url: "u" } as any,
  reviews: { notice: "n", interview_total: 0, work_total: 0, interviews: [], work: [] },
};
const QOLLIE = {
  status: "ok" as const,
  data: { company_id: "qid", url: "q" } as any,
  reviews: { notice: "n", items: [] },
};
const ITW = {
  status: "ok" as const,
  data: { short_id: "KYRX", url: "i" } as any,
};
const WEB = {
  status: "ok" as const,
  results: [],
  truncated: false,
};

function keysAnywhere(obj: unknown, banned: Set<string>): boolean {
  if (Array.isArray(obj)) {
    return obj.some((v) => keysAnywhere(v, banned));
  }
  if (obj && typeof obj === "object") {
    for (const [k, v] of Object.entries(obj)) {
      if (banned.has(k) || keysAnywhere(v, banned)) {
        return true;
      }
    }
  }
  return false;
}

describe("company/research", () => {
  let byTaxSpy: ReturnType<typeof vi.spyOn>;
  let resolveSpy: ReturnType<typeof vi.spyOn>;
  let goodjobSpy: ReturnType<typeof vi.spyOn>;
  let qollieSpy: ReturnType<typeof vi.spyOn>;
  let itwSpy: ReturnType<typeof vi.spyOn>;
  let webSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    byTaxSpy = vi.spyOn(research._deps, "getByTaxId").mockResolvedValue(COMPANY as any);
    resolveSpy = vi.spyOn(research._deps, "resolveName").mockResolvedValue({
      status: "ok",
      tax_id: TAX,
      name: NAME,
    });
    goodjobSpy = vi.spyOn(research._deps, "goodjobGet").mockResolvedValue(GOODJOB as any);
    qollieSpy = vi.spyOn(research._deps, "qollieGet").mockResolvedValue(QOLLIE as any);
    itwSpy = vi.spyOn(research._deps, "interviewTwGet").mockResolvedValue(ITW as any);
    webSpy = vi.spyOn(research._deps, "webSearch").mockResolvedValue(WEB as any);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("test_eight_digits_is_tax_id", async () => {
    const out = await research.run(TAX);
    expect(byTaxSpy).toHaveBeenCalledTimes(1);
    expect(resolveSpy).not.toHaveBeenCalled();
    expect(out.query).toEqual({ input: TAX, tax_id: TAX, name: NAME });
  });

  it("test_name_is_resolved_then_fetched", async () => {
    const out = await research.run(NAME);
    expect(resolveSpy).toHaveBeenCalledTimes(1);
    expect(byTaxSpy).toHaveBeenCalledWith(TAX);
    expect(out.company).toEqual(COMPANY);
  });

  it.each(["", "   "])("test_empty_input_rejected_without_requests %j", async (bad) => {
    await expect(research.run(bad)).rejects.toThrow();
    expect(byTaxSpy).not.toHaveBeenCalled();
    expect(resolveSpy).not.toHaveBeenCalled();
    expect(goodjobSpy).not.toHaveBeenCalled();
    expect(qollieSpy).not.toHaveBeenCalled();
    expect(itwSpy).not.toHaveBeenCalled();
    expect(webSpy).not.toHaveBeenCalled();
  });

  it.each([0, -1, 51, 1000])("test_review_limit_out_of_range_rejected %i", async (n) => {
    await expect(research.run(TAX, { reviewLimit: n })).rejects.toThrow(/review_limit/);
    expect(byTaxSpy).not.toHaveBeenCalled();
    expect(webSpy).not.toHaveBeenCalled();
  });

  it("test_full_success_shape", async () => {
    const out = await research.run(TAX);
    expect(Object.keys(out).sort()).toEqual([
      "company",
      "goodjob",
      "interview_tw",
      "links",
      "qollie",
      "query",
      "web",
    ]);
    expect([out.company.status, out.goodjob.status, out.qollie.status, out.interview_tw.status, out.web.status]).toEqual(
      ["ok", "ok", "ok", "ok", "ok"],
    );
  });

  it("test_reviews_options_passed_through", async () => {
    await research.run(TAX, { includeReviews: false, reviewLimit: 5 });
    expect(goodjobSpy).toHaveBeenCalledWith(TAX, { includeReviews: false, reviewLimit: 5 });
    expect(qollieSpy).toHaveBeenCalledWith(NAME, TAX, { includeReviews: false, reviewLimit: 5 });
  });

  it("test_reviews_default_on_and_twenty", async () => {
    await research.run(TAX);
    expect(goodjobSpy).toHaveBeenCalledWith(TAX, { includeReviews: true, reviewLimit: 20 });
  });

  it("test_links_use_ids_returned_by_sources", async () => {
    const out = await research.run(TAX);
    expect(out.links.qollie.endsWith("/qid")).toBe(true);
    expect(out.links.interview_tw.endsWith("/KYRX")).toBe(true);
    expect(out.links.goodjob.includes("TSMC") || out.links.goodjob.includes("%20TSMC")).toBe(true);
  });

  it("test_web_gets_name_and_key", async () => {
    await research.run(TAX, { tavilyKey: "tvly-x" });
    expect(webSpy).toHaveBeenCalledWith(NAME, "tvly-x");
  });

  it("test_one_source_failing_does_not_break_others", async () => {
    goodjobSpy.mockRejectedValue(new SourceError("network", "連線 GoodJob 失敗：Timeout"));
    const out = await research.run(TAX);
    expect(out.goodjob).toEqual({
      status: "error",
      error: { type: "network", message: "連線 GoodJob 失敗：Timeout" },
    });
    expect(out.company.status).toBe("ok");
    expect(out.qollie.status).toBe("ok");
    expect(out.interview_tw.status).toBe("ok");
  });

  it("test_unexpected_exception_is_contained", async () => {
    qollieSpy.mockRejectedValue(new Error("boom"));
    const out = await research.run(TAX);
    expect(out.qollie.status).toBe("error");
    if (out.qollie.status !== "error") throw new Error("unreachable");
    expect(out.qollie.error.type).toBe("internal");
    expect(out.goodjob.status).toBe("ok");
  });

  it("test_not_found_sources_pass_through", async () => {
    itwSpy.mockResolvedValue({ status: "not_found" });
    const out = await research.run(TAX);
    expect(out.interview_tw).toEqual({ status: "not_found" });
  });

  it("test_all_sources_failing_still_returns_links", async () => {
    const err = new SourceError("blocked", "擋");
    byTaxSpy.mockRejectedValue(err);
    goodjobSpy.mockRejectedValue(err);
    qollieSpy.mockRejectedValue(err);
    itwSpy.mockRejectedValue(err);
    webSpy.mockRejectedValue(err);
    const out = await research.run(TAX);
    expect(out.company.status).toBe("error");
    expect(out.links).toBeTruthy();
    expect(Object.values(out.links).every((v) => v.startsWith("https://"))).toBe(true);
  });

  it("test_ambiguous_name_needs_selection_and_skips_review_sources", async () => {
    resolveSpy.mockResolvedValue({
      status: "needs_selection",
      candidates: [{ tax_id: "1", name: "甲", status: "核准設立", address: "x" }],
    });
    const out = await research.run("台積電", { tavilyKey: "k" });
    expect(out.company.status).toBe("needs_selection");
    if (out.company.status !== "needs_selection") throw new Error("unreachable");
    expect(out.company.candidates.length).toBeGreaterThan(0);
    expect([out.goodjob.status, out.qollie.status, out.interview_tw.status]).toEqual([
      "skipped",
      "skipped",
      "skipped",
    ]);
    expect(goodjobSpy).not.toHaveBeenCalled();
    expect(qollieSpy).not.toHaveBeenCalled();
    expect(itwSpy).not.toHaveBeenCalled();
    expect(byTaxSpy).not.toHaveBeenCalled();
    expect(webSpy).toHaveBeenCalledWith("台積電", "k");
    expect(out.links).toBeTruthy();
  });

  it("test_unresolved_name_skips_review_sources", async () => {
    resolveSpy.mockResolvedValue({ status: "not_found", message: "查無" });
    const out = await research.run("不存在公司");
    expect(out.company.status).toBe("not_found");
    expect([out.goodjob.status, out.qollie.status, out.interview_tw.status]).toEqual([
      "skipped",
      "skipped",
      "skipped",
    ]);
    expect(out.query.tax_id).toBeNull();
  });

  it("test_tax_id_not_in_registry_skips_review_sources", async () => {
    byTaxSpy.mockResolvedValue({ status: "not_found" });
    const out = await research.run("99999999");
    expect(out.company.status).toBe("not_found");
    expect([out.goodjob.status, out.qollie.status, out.interview_tw.status]).toEqual([
      "skipped",
      "skipped",
      "skipped",
    ]);
  });

  it("test_registry_error_is_reported_and_skips_review_sources", async () => {
    resolveSpy.mockRejectedValue(new SourceError("network", "連線失敗"));
    const out = await research.run(NAME);
    expect(out.company.status).toBe("error");
    expect(out.goodjob.status).toBe("skipped");
  });

  it("test_no_scoring_or_recommendation_fields", async () => {
    const out = await research.run(TAX);
    const banned = new Set([
      "score",
      "grade",
      "verdict",
      "recommendation",
      "recommend_score",
      "overall",
      "health",
    ]);
    expect(keysAnywhere(out, banned)).toBe(false);
  });

  it("test_nothing_is_written_to_disk", async () => {
    const writeFileSyncSpy = vi.spyOn(fs, "writeFileSync").mockImplementation(() => {
      throw new Error("writeFileSync called");
    });
    const writeFilePromiseSpy = vi.spyOn(fs.promises, "writeFile").mockImplementation(async () => {
      throw new Error("fs.promises.writeFile called");
    });
    const appendFileSyncSpy = vi.spyOn(fs, "appendFileSync").mockImplementation(() => {
      throw new Error("appendFileSync called");
    });

    const out = await research.run(TAX);
    expect(JSON.stringify(out)).toBeTruthy();
    expect(writeFileSyncSpy).not.toHaveBeenCalled();
    expect(writeFilePromiseSpy).not.toHaveBeenCalled();
    expect(appendFileSyncSpy).not.toHaveBeenCalled();
  });

  it("test_review_sources_run_concurrently", async () => {
    let arrived = 0;
    let openBarrier!: () => void;
    const barrier = new Promise<void>((resolve) => {
      openBarrier = resolve;
    });
    const meet = <T,>(result: T) => async () => {
      arrived += 1;
      if (arrived === 4) {
        openBarrier();
      }
      await Promise.race([
        barrier,
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error("barrier timeout")), 500)),
      ]);
      return result;
    };

    goodjobSpy.mockImplementation(meet(GOODJOB));
    qollieSpy.mockImplementation(meet(QOLLIE));
    itwSpy.mockImplementation(meet(ITW));
    webSpy.mockImplementation(meet(WEB));

    const out = await research.run(TAX);
    expect([out.goodjob.status, out.qollie.status, out.interview_tw.status, out.web.status]).toEqual([
      "ok",
      "ok",
      "ok",
      "ok",
    ]);
  });

  it("test_result_order_and_keys_are_stable_under_concurrency", async () => {
    const out = await research.run(TAX);
    expect(Object.keys(out)).toEqual([
      "query",
      "company",
      "goodjob",
      "qollie",
      "interview_tw",
      "web",
      "links",
    ]);
  });
});
