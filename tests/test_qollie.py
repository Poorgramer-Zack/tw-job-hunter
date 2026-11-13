import copy
import json
import re

import pytest

from conftest import FakeResponse, load_company
from tw_job_hunter.company import qollie
from tw_job_hunter.company.http import SourceError

URL = "www.qollie.com/graphql"
CID = "5860c66430162b7e4c17de29"


def route(fake_http, search=None, stat=None, comments=None):
    def respond(call):
        q = call["json"]["query"]
        if "searchCompanies" in q:
            return FakeResponse(json_data=search or load_company("qollie_search.json"))
        if "getCompanyStat" in q:
            return FakeResponse(json_data=stat or load_company("qollie_stat.json"))
        if "searchComments" in q:
            return FakeResponse(json_data=comments or load_company("qollie_comments.json"))
        raise AssertionError(q)

    fake_http.add(URL, respond)


def queries(fake_http):
    return [c["json"]["query"] for c in fake_http.calls]


def test_short_name_strips_company_suffix():
    assert qollie.short_name("台灣積體電路製造股份有限公司") == "台灣積體電路製造"
    assert qollie.short_name("某某有限公司") == "某某"
    assert qollie.short_name("某某") == "某某"


def test_stats_only(fake_http):
    route(fake_http)
    out = qollie.get("台灣積體電路製造股份有限公司", "22099131", include_reviews=False)
    assert out["status"] == "ok"
    assert out["data"] == {"company_id": CID, "url": f"https://www.qollie.com/companies/{CID}",
                           "good": 3, "normal": 14, "bad": 4, "total": 42, "experienced": 21, "question": 5, "chat": 16}
    assert "reviews" not in out
    assert not any("searchComments" in q for q in queries(fake_http))


def test_matches_by_tax_id_not_first_row(fake_http):
    search = {"data": {"searchCompanies": [{"_id": "x1", "name": "不相干", "taxId": "11111111"}, {"_id": CID, "name": "台積電", "taxId": "22099131"}]}}
    route(fake_http, search=search)
    assert qollie.get("台灣積體電路製造股份有限公司", "22099131", include_reviews=False)["data"]["company_id"] == CID


def test_no_matching_tax_id_is_not_found(fake_http):
    route(fake_http, search={"data": {"searchCompanies": [{"_id": "x1", "name": "不相干", "taxId": "11111111"}]}})
    assert qollie.get("某公司", "22099131") == {"status": "not_found"}
    assert not any("getCompanyStat" in q for q in queries(fake_http))


def test_empty_search_is_not_found(fake_http):
    route(fake_http, search={"data": {"searchCompanies": []}})
    assert qollie.get("某公司", "22099131") == {"status": "not_found"}


def test_graphql_errors_are_schema_error(fake_http):
    fake_http.add(URL, FakeResponse(json_data={"errors": [{"message": "boom"}]}))
    with pytest.raises(SourceError) as e:
        qollie.get("某公司", "22099131")
    assert e.value.type == "schema"


# ---------- 評論 ----------
def test_reviews_sorted_newest_first_and_limited(fake_http):
    route(fake_http)
    out = qollie.get("台灣積體電路製造股份有限公司", "22099131", review_limit=2)
    items = out["reviews"]["items"]
    assert [i["posted"] for i in items] == ["2024-08-26", "2021-07-02"]
    assert "第三方" in out["reviews"]["notice"]
    assert set(items[0]) == {"source", "url", "judge", "category", "content", "pros", "cons", "posted"}
    assert items[0]["source"] == "qollie" and items[0]["pros"] and items[0]["cons"]


def test_comment_query_fetches_fifty_for_local_sort(fake_http):
    route(fake_http)
    qollie.get("台灣積體電路製造股份有限公司", "22099131", review_limit=3)
    q = next(c for c in fake_http.calls if "searchComments" in c["json"]["query"])
    assert re.search(r"limit:\s*50", q["json"]["query"]) or q["json"]["variables"].get("limit") == 50


@pytest.mark.parametrize("flag", [True, False])
def test_queries_never_ask_for_identity_fields(fake_http, flag):
    route(fake_http)
    qollie.get("台灣積體電路製造股份有限公司", "22099131", include_reviews=flag)
    for q in queries(fake_http):
        assert not re.search(r"\b(ip|IP|user|author|nickname|email|userId)\b", q), q


def test_ip_and_author_fields_never_reach_output(fake_http):
    comments = copy.deepcopy(load_company("qollie_comments.json"))
    for c in comments["data"]["searchComments"]:
        c.update(ip="203.0.113.7", author="王小明", user={"name": "某人"}, likesCount=9)
    route(fake_http, comments=comments)
    out = qollie.get("台灣積體電路製造股份有限公司", "22099131")
    dumped = json.dumps(out, ensure_ascii=False)
    assert "203.0.113.7" not in dumped and "王小明" not in dumped and "某人" not in dumped and "likesCount" not in dumped


def test_long_text_clipped(fake_http):
    comments = copy.deepcopy(load_company("qollie_comments.json"))
    comments["data"]["searchComments"][0]["content"] = "字" * 2000
    comments["data"]["searchComments"][0]["pros"] = "好" * 2000
    route(fake_http, comments=comments)
    for it in qollie.get("台灣積體電路製造股份有限公司", "22099131")["reviews"]["items"]:
        for k in ("content", "pros", "cons"):
            assert it[k] is None or len(it[k]) <= 601
