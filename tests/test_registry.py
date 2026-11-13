from datetime import date

import pytest

from conftest import FakeResponse, load_company
from tw_job_hunter.company import registry
from tw_job_hunter.company.http import SourceError

TODAY = date(2026, 11, 13)
TAXID_API = "5F64D864-61CB-4D0D-8AD9-492047CC1EA6"
NAME_API = "6BBA2268-1367-4B42-9CCA-BC17499EBE8C"


def row(tax_id, name, status="01", desc="核准設立", addr="某地址"):
    return {"Business_Accounting_NO": tax_id, "Company_Name": name, "Company_Status": status,
            "Company_Status_Desc": desc, "Company_Location": addr, "Responsible_Name": "測試負責人",
            "Capital_Stock_Amount": 1000, "Paid_In_Capital_Amount": 0, "Company_Setup_Date": "1000101"}


# ---------- 統編查詢 ----------
def test_get_by_tax_id_ok(fake_http):
    fake_http.add(TAXID_API, FakeResponse(json_data=load_company("gcis_taxid.json")))
    out = registry.get_by_tax_id("22099131", today=TODAY)
    assert out["status"] == "ok"
    d = out["data"]
    assert d["tax_id"] == "22099131" and d["name"] == "台灣積體電路製造股份有限公司"
    assert d["status"] == "核准設立" and d["capital"] == 280500000000 and d["paid_in_capital"] == 259323700670
    assert d["responsible"] == "魏哲家" and d["address"] == "新竹科學園區新竹市力行六路8號"
    assert d["setup_date"] == "1987-02-21" and d["years_since_setup"] == 39
    assert fake_http.calls[0]["params"]["$filter"] == "Business_Accounting_NO eq 22099131"


def test_years_since_setup_before_anniversary():
    assert registry.years_since("1987-02-21", date(2026, 2, 20)) == 38
    assert registry.years_since("1987-02-21", date(2026, 2, 21)) == 39


@pytest.mark.parametrize("raw,iso", [("0760221", "1987-02-21"), ("1150821", "2026-08-21"), ("", None), (None, None), ("abc", None)])
def test_roc_to_iso(raw, iso):
    assert registry.roc_to_iso(raw) == iso


def test_missing_setup_date_gives_null(fake_http):
    r = row("12345678", "某公司")
    r["Company_Setup_Date"] = ""
    fake_http.add(TAXID_API, FakeResponse(json_data=[r]))
    d = registry.get_by_tax_id("12345678", today=TODAY)["data"]
    assert d["setup_date"] is None and d["years_since_setup"] is None


@pytest.mark.parametrize("bad", ["", "2209913", "220991311", "abcdefgh", "2209 131"])
def test_tax_id_format_rejected_without_request(fake_http, bad):
    with pytest.raises(ValueError, match="統一編號"):
        registry.get_by_tax_id(bad)
    assert fake_http.calls == []


def test_tax_id_not_found_empty_body(fake_http):
    fake_http.add(TAXID_API, FakeResponse(status=200, body=""))
    assert registry.get_by_tax_id("99999999") == {"status": "not_found"}


def test_dissolved_company_still_returned(fake_http):
    fake_http.add(TAXID_API, FakeResponse(json_data=[{**row("12345678", "已廢止公司", "09", "廢止"), "Company_Status_Desc": "廢止"}]))
    out = registry.get_by_tax_id("12345678", today=TODAY)
    assert out["status"] == "ok" and out["data"]["status"] == "廢止"


# ---------- 名稱解析 ----------
def test_resolve_single_full_name(fake_http):
    fake_http.add(NAME_API, FakeResponse(json_data=load_company("gcis_name_search.json")))
    out = registry.resolve_name("台灣積體電路製造股份有限公司")
    assert out == {"status": "ok", "tax_id": "22099131", "name": "台灣積體電路製造股份有限公司"}


def test_resolve_name_without_suffix_adopts_when_only_one_full_match(fake_http):
    fake_http.add(NAME_API, FakeResponse(json_data=load_company("gcis_name_search.json")))
    assert registry.resolve_name("台灣積體電路製造")["tax_id"] == "22099131"


def test_resolve_always_sends_status_filter(fake_http):
    fake_http.add(NAME_API, FakeResponse(json_data=[row("1", "甲股份有限公司")]))
    registry.resolve_name("甲股份有限公司")
    assert all("Company_Status eq 01" in c["params"]["$filter"] for c in fake_http.calls)


def test_resolve_tries_both_tai_spellings_and_merges(fake_http):
    def respond(call):
        flt = call["params"]["$filter"]
        return FakeResponse(json_data=[row("22099131", "台灣積體電路製造股份有限公司")]) if "台灣" in flt else FakeResponse(body="")

    fake_http.add(NAME_API, respond)
    out = registry.resolve_name("臺灣積體電路製造股份有限公司")
    assert out["status"] == "ok" and out["tax_id"] == "22099131"
    assert len(fake_http.calls) == 2


def test_resolve_exact_name_beats_other_matches(fake_http):
    rows = [row("1", "甲乙科技股份有限公司"), row("2", "甲乙科技股份有限公司台北分公司"), row("3", "新甲乙科技有限公司")]
    fake_http.add(NAME_API, FakeResponse(json_data=rows))
    assert registry.resolve_name("甲乙科技股份有限公司")["tax_id"] == "1"


def test_resolve_abbreviation_hitting_unrelated_company_needs_selection(fake_http):
    fake_http.add(NAME_API, FakeResponse(json_data=load_company("gcis_name_abbrev.json")))
    out = registry.resolve_name("台積電")
    assert out["status"] == "needs_selection"
    assert [c["name"] for c in out["candidates"]] == ["台積電機有限公司", "台積電梯有限公司"]
    assert set(out["candidates"][0]) == {"tax_id", "name", "status", "address"}


def test_resolve_many_candidates_capped_at_ten(fake_http):
    rows = [row(f"{i:08d}", f"鴻海{i}企業社") for i in range(25)]
    fake_http.add(NAME_API, FakeResponse(json_data=rows))
    out = registry.resolve_name("鴻海")
    assert out["status"] == "needs_selection" and len(out["candidates"]) == 10


def test_resolve_not_found_has_hint(fake_http):
    fake_http.add(NAME_API, FakeResponse(status=200, body=""))
    out = registry.resolve_name("不存在的公司")
    assert out["status"] == "not_found" and "統編" in out["message"]


def test_resolve_strips_whitespace(fake_http):
    fake_http.add(NAME_API, FakeResponse(json_data=[row("1", "甲股份有限公司")]))
    assert registry.resolve_name("  甲股份有限公司 ")["tax_id"] == "1"
    assert "甲股份有限公司" in fake_http.calls[0]["params"]["$filter"] and "  " not in fake_http.calls[0]["params"]["$filter"]


def test_resolve_empty_name_rejected(fake_http):
    with pytest.raises(ValueError):
        registry.resolve_name("  ")
    assert fake_http.calls == []


def test_source_error_propagates(fake_http):
    fake_http.add(NAME_API, FakeResponse(status=500, body="x"))
    with pytest.raises(SourceError):
        registry.resolve_name("甲公司")


def test_resolve_stops_after_exact_match_in_first_spelling(fake_http):
    fake_http.add(NAME_API, FakeResponse(json_data=[row("22099131", "台灣積體電路製造股份有限公司")]))
    assert registry.resolve_name("台灣積體電路製造股份有限公司")["tax_id"] == "22099131"
    assert len(fake_http.calls) == 1  # 已有完全相同的結果，不再查另一種寫法


def test_company_tails_shared_with_common():
    from tw_job_hunter.company import common

    assert set(common.COMPANY_SUFFIXES) <= set(registry.FULL_NAME_TAILS) and "公司" in registry.FULL_NAME_TAILS
