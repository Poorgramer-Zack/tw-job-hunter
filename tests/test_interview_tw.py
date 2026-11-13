import json

import pytest

from conftest import FakeResponse, load_company
from tw_job_hunter.company import interview_tw
from tw_job_hunter.company.http import SourceError

AC = "auto-complete/companies"
SECRET = "這是精選心得全文，不可以出現在輸出裡"


def serve(fake_http, page=None, autocomplete=None, salary=None):
    fake_http.add(AC, FakeResponse(json_data=autocomplete or load_company("itw_autocomplete.json")))
    fake_http.add("/c/KYRX/salary-average", FakeResponse(json_data=salary or load_company("itw_salary_average.json")))
    fake_http.add("/c/KYRX", FakeResponse(body=page if page is not None else load_company("itw_company.html")))


def test_summary_numbers_and_links(fake_http):
    serve(fake_http)
    out = interview_tw.get("台灣積體電路製造股份有限公司", "22099131")
    assert out["status"] == "ok"
    d = out["data"]
    assert d["short_id"] == "KYRX" and d["url"] == "https://interview.tw/c/KYRX" and d["salary_url"] == "https://salary.tw/c/KYRX"
    assert d["interview_count"] == "4714" and d["rating"] == "3.9/5" and d["offer_rate"] == "48%"
    assert d["difficulty"] == "低" and d["avg_monthly_salary"] == "53k" and d["salary_reports"] == "2082"
    assert d["review_count"] == 4714 and d["rating_value"] == 3.9
    assert not any("salary-average" in c["url"] for c in fake_http.calls)


def test_autocomplete_matched_by_code(fake_http):
    ac = {"source": [{"id": "a", "name": "別家", "shortId": "ZZZZ", "score": 1, "code": "11111111"},
                     {"id": "b", "name": "台積電_台灣積體電路製造股份有限公司", "shortId": "KYRX", "score": 4714, "code": "22099131"}]}
    serve(fake_http, autocomplete=ac)
    assert interview_tw.get("台灣積體電路製造股份有限公司", "22099131")["data"]["short_id"] == "KYRX"


@pytest.mark.parametrize("source", [[], [{"id": "a", "name": "外商", "shortId": "ZZZZ", "score": 3, "code": None}], [{"id": "a", "name": "別家", "shortId": "ZZZZ", "score": 1, "code": "11111111"}]])
def test_no_code_match_is_not_found(fake_http, source):
    serve(fake_http, autocomplete={"source": source})
    out = interview_tw.get("某公司", "22099131")
    assert out["status"] == "not_found"
    assert not any("/c/" in c["url"] for c in fake_http.calls)


def test_dash_salary_fetches_salary_average(fake_http):
    page = load_company("itw_company.html").replace(">53k<", ">-<")
    serve(fake_http, page=page)
    d = interview_tw.get("台灣積體電路製造股份有限公司", "22099131")["data"]
    assert d["avg_monthly_salary"] == "39.2k" or d["avg_monthly_salary"] == load_company("itw_salary_average.json")["display"]
    assert any("salary-average" in c["url"] for c in fake_http.calls)


def test_no_review_text_in_output(fake_http):
    page = load_company("itw_company.html").replace("</body>", f'<div class="iw_interview-card"><p>{SECRET}</p></div></body>')
    serve(fake_http, page=page)
    out = interview_tw.get("台灣積體電路製造股份有限公司", "22099131")
    assert SECRET not in json.dumps(out, ensure_ascii=False)


def test_page_without_stats_is_schema_error(fake_http):
    serve(fake_http, page="<html><body>maintenance</body></html>")
    with pytest.raises(SourceError) as e:
        interview_tw.get("台灣積體電路製造股份有限公司", "22099131")
    assert e.value.type == "schema"


def test_never_requests_disallowed_paths(fake_http):
    serve(fake_http)
    interview_tw.get("台灣積體電路製造股份有限公司", "22099131")
    for c in fake_http.calls:
        u = c["url"]
        assert "/search" not in u and "/auth/" not in u and "/interviews" not in u
        assert not any(k in (c["params"] or {}) for k in ("sort", "position", "area"))


def test_autocomplete_uses_json_headers_and_short_name(fake_http):
    serve(fake_http)
    interview_tw.get("台灣積體電路製造股份有限公司", "22099131")
    c = fake_http.calls[0]
    assert c["params"]["search"] == "台灣積體電路製造" and c["headers"]["X-Requested-With"] == "XMLHttpRequest"
