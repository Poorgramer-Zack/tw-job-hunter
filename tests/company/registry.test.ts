import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as common from "../../src/company/common.js";
import * as http from "../../src/company/http.js";
import { SourceError } from "../../src/company/http.js";
import * as registry from "../../src/company/registry.js";
import { FakeHTTP, FakeResponse, loadCompany } from "./helpers.js";

const TODAY = new Date(2026, 10, 13); // 2026-11-13
const TAXID_API = "5F64D864-61CB-4D0D-8AD9-492047CC1EA6";
const NAME_API = "6BBA2268-1367-4B42-9CCA-BC17499EBE8C";

function row(taxId: string, name: string, status = "01", desc = "核准設立", addr = "某地址") {
  return {
    Business_Accounting_NO: taxId,
    Company_Name: name,
    Company_Status: status,
    Company_Status_Desc: desc,
    Company_Location: addr,
    Responsible_Name: "測試負責人",
    Capital_Stock_Amount: 1000,
    Paid_In_Capital_Amount: 0,
    Company_Setup_Date: "1000101",
  };
}

describe("company/registry", () => {
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

  it("test_get_by_tax_id_ok", async () => {
    fakeHttp.add(TAXID_API, new FakeResponse({ jsonData: loadCompany("gcis_taxid.json") }));
    const out = await registry.getByTaxId("22099131", TODAY);
    expect(out.status).toBe("ok");
    if (out.status !== "ok") throw new Error("unreachable");
    const d = out.data;
    expect(d.tax_id).toBe("22099131");
    expect(d.name).toBe("台灣積體電路製造股份有限公司");
    expect(d.status).toBe("核准設立");
    expect(d.capital).toBe(280500000000);
    expect(d.paid_in_capital).toBe(259323700670);
    expect(d.responsible).toBe("魏哲家");
    expect(d.address).toBe("新竹科學園區新竹市力行六路8號");
    expect(d.setup_date).toBe("1987-02-21");
    expect(d.years_since_setup).toBe(39);
    expect(fakeHttp.calls[0].params["$filter"]).toBe("Business_Accounting_NO eq 22099131");
  });

  it("test_years_since_setup_before_anniversary", () => {
    expect(registry.yearsSince("1987-02-21", new Date(2026, 1, 20))).toBe(38);
    expect(registry.yearsSince("1987-02-21", new Date(2026, 1, 21))).toBe(39);
  });

  it.each([
    ["0760221", "1987-02-21"],
    ["1150821", "2026-08-21"],
    ["", null],
    [null, null],
    ["abc", null],
  ])("test_roc_to_iso %j -> %j", (raw, iso) => {
    expect(registry.rocToIso(raw)).toBe(iso);
  });

  it("test_missing_setup_date_gives_null", async () => {
    const r = row("12345678", "某公司");
    r.Company_Setup_Date = "";
    fakeHttp.add(TAXID_API, new FakeResponse({ jsonData: [r] }));
    const out = await registry.getByTaxId("12345678", TODAY);
    if (out.status !== "ok") throw new Error("unreachable");
    expect(out.data.setup_date).toBeNull();
    expect(out.data.years_since_setup).toBeNull();
  });

  it.each(["", "2209913", "220991311", "abcdefgh", "2209 131"])(
    "test_tax_id_format_rejected_without_request %j",
    async (bad) => {
      await expect(registry.getByTaxId(bad)).rejects.toThrow(/統一編號/);
      expect(fakeHttp.calls).toEqual([]);
    },
  );

  it("test_tax_id_not_found_empty_body", async () => {
    fakeHttp.add(TAXID_API, new FakeResponse({ status: 200, body: "" }));
    expect(await registry.getByTaxId("99999999")).toEqual({ status: "not_found" });
  });

  it("test_dissolved_company_still_returned", async () => {
    fakeHttp.add(TAXID_API, new FakeResponse({ jsonData: [{ ...row("12345678", "已廢止公司", "09", "廢止"), Company_Status_Desc: "廢止" }] }));
    const out = await registry.getByTaxId("12345678", TODAY);
    expect(out.status).toBe("ok");
    if (out.status !== "ok") throw new Error("unreachable");
    expect(out.data.status).toBe("廢止");
  });

  it("test_resolve_single_full_name", async () => {
    fakeHttp.add(NAME_API, new FakeResponse({ jsonData: loadCompany("gcis_name_search.json") }));
    const out = await registry.resolveName("台灣積體電路製造股份有限公司");
    expect(out).toEqual({ status: "ok", tax_id: "22099131", name: "台灣積體電路製造股份有限公司" });
  });

  it("test_resolve_name_without_suffix_adopts_when_only_one_full_match", async () => {
    fakeHttp.add(NAME_API, new FakeResponse({ jsonData: loadCompany("gcis_name_search.json") }));
    const out = await registry.resolveName("台灣積體電路製造");
    if (out.status !== "ok") throw new Error("unreachable");
    expect(out.tax_id).toBe("22099131");
  });

  it("test_resolve_always_sends_status_filter", async () => {
    fakeHttp.add(NAME_API, new FakeResponse({ jsonData: [row("1", "甲股份有限公司")] }));
    await registry.resolveName("甲股份有限公司");
    expect(fakeHttp.calls.every((c) => c.params["$filter"].includes("Company_Status eq 01"))).toBe(true);
  });

  it("test_resolve_tries_both_tai_spellings_and_merges", async () => {
    fakeHttp.add(NAME_API, (call) => {
      const flt = call.params["$filter"];
      return flt.includes("台灣")
        ? new FakeResponse({ jsonData: [row("22099131", "台灣積體電路製造股份有限公司")] })
        : new FakeResponse({ body: "" });
    });
    const out = await registry.resolveName("臺灣積體電路製造股份有限公司");
    expect(out.status).toBe("ok");
    if (out.status !== "ok") throw new Error("unreachable");
    expect(out.tax_id).toBe("22099131");
    expect(fakeHttp.calls).toHaveLength(2);
  });

  it("test_resolve_exact_name_beats_other_matches", async () => {
    const rows = [
      row("1", "甲乙科技股份有限公司"),
      row("2", "甲乙科技股份有限公司台北分公司"),
      row("3", "新甲乙科技有限公司"),
    ];
    fakeHttp.add(NAME_API, new FakeResponse({ jsonData: rows }));
    const out = await registry.resolveName("甲乙科技股份有限公司");
    if (out.status !== "ok") throw new Error("unreachable");
    expect(out.tax_id).toBe("1");
  });

  it("test_resolve_abbreviation_hitting_unrelated_company_needs_selection", async () => {
    fakeHttp.add(NAME_API, new FakeResponse({ jsonData: loadCompany("gcis_name_abbrev.json") }));
    const out = await registry.resolveName("台積電");
    expect(out.status).toBe("needs_selection");
    if (out.status !== "needs_selection") throw new Error("unreachable");
    expect(out.candidates.map((c) => c.name)).toEqual(["台積電機有限公司", "台積電梯有限公司"]);
    expect(Object.keys(out.candidates[0]).sort()).toEqual(["address", "name", "status", "tax_id"]);
  });

  it("test_resolve_many_candidates_capped_at_ten", async () => {
    const rows = Array.from({ length: 25 }, (_, i) => row(String(i).padStart(8, "0"), `鴻海${i}企業社`));
    fakeHttp.add(NAME_API, new FakeResponse({ jsonData: rows }));
    const out = await registry.resolveName("鴻海");
    expect(out.status).toBe("needs_selection");
    if (out.status !== "needs_selection") throw new Error("unreachable");
    expect(out.candidates).toHaveLength(10);
  });

  it("test_resolve_not_found_has_hint", async () => {
    fakeHttp.add(NAME_API, new FakeResponse({ status: 200, body: "" }));
    const out = await registry.resolveName("不存在的公司");
    expect(out.status).toBe("not_found");
    if (out.status !== "not_found") throw new Error("unreachable");
    expect(out.message).toContain("統編");
  });

  it("test_resolve_strips_whitespace", async () => {
    fakeHttp.add(NAME_API, new FakeResponse({ jsonData: [row("1", "甲股份有限公司")] }));
    const out = await registry.resolveName("  甲股份有限公司 ");
    if (out.status !== "ok") throw new Error("unreachable");
    expect(out.tax_id).toBe("1");
    expect(fakeHttp.calls[0].params["$filter"]).toContain("甲股份有限公司");
    expect(fakeHttp.calls[0].params["$filter"]).not.toContain("  ");
  });

  it("test_resolve_empty_name_rejected", async () => {
    await expect(registry.resolveName("  ")).rejects.toThrow();
    expect(fakeHttp.calls).toEqual([]);
  });

  it("test_source_error_propagates", async () => {
    fakeHttp.add(NAME_API, new FakeResponse({ status: 500, body: "x" }));
    await expect(registry.resolveName("甲公司")).rejects.toBeInstanceOf(SourceError);
  });

  it("test_resolve_stops_after_exact_match_in_first_spelling", async () => {
    fakeHttp.add(NAME_API, new FakeResponse({ jsonData: [row("22099131", "台灣積體電路製造股份有限公司")] }));
    const out = await registry.resolveName("台灣積體電路製造股份有限公司");
    if (out.status !== "ok") throw new Error("unreachable");
    expect(out.tax_id).toBe("22099131");
    expect(fakeHttp.calls).toHaveLength(1);
  });

  it("test_company_tails_shared_with_common", () => {
    for (const s of common.COMPANY_SUFFIXES) {
      expect(registry.FULL_NAME_TAILS).toContain(s);
    }
    expect(registry.FULL_NAME_TAILS).toContain("公司");
  });
});
