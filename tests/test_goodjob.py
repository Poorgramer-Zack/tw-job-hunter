import copy
import re

import pytest

from conftest import FakeResponse, load_company
from tw_job_hunter.company import goodjob
from tw_job_hunter.company.http import SourceError

API = "api.goodjob.life"
FORBIDDEN = ["gender", "education", "sector", "jobLevel", "author", "nickname", "userId", "email", "salary{"]


def served(fake_http, payload=None):
    fake_http.add(API, FakeResponse(json_data=payload or load_company("goodjob_taxid_22099131.json")))


def sent_query(fake_http):
    return fake_http.calls[0]["json"]["query"]


def test_stats_and_link(fake_http):
    served(fake_http)
    out = goodjob.get("22099131", include_reviews=False)
    assert out["status"] == "ok"
    d = out["data"]
    assert d["tax_id"] == "22099131" and d["name"].startswith("台灣積體電路製造股份有限公司")
    assert d["url"] == "https://www.goodjob.life/companies/" + __import__("urllib.parse").parse.quote(d["name"])
    assert d["data_count"] == 5096 and d["experience_count"] == 3940 and d["salary_work_time_count"] == 1156
    assert d["rating"]["average"] == pytest.approx(3.877, abs=0.001) and d["rating"]["count"] == 3819
    assert d["avg_week_work_time"] == pytest.approx(52.03, abs=0.01) and d["avg_hourly_wage"] == pytest.approx(519.56, abs=0.01)
    assert set(d["overtime_frequency"]) == {"seldom", "sometimes", "usually", "almost_everyday"}
    assert d["aspect_ratings"] and set(d["aspect_ratings"][0]) == {"aspect", "average", "count"}
    assert d["top_job_titles"]


def test_only_matching_business_number_is_used(fake_http):
    served(fake_http, load_company("goodjob_not_found.json"))
    assert goodjob.get("00000000") == {"status": "not_found"}


def test_graphql_errors_are_schema_error(fake_http):
    fake_http.add(API, FakeResponse(json_data={"errors": [{"message": "Cannot query field x"}]}))
    with pytest.raises(SourceError) as e:
        goodjob.get("22099131")
    assert e.value.type == "schema"


def test_missing_data_is_schema_error(fake_http):
    fake_http.add(API, FakeResponse(json_data={"data": {}}))
    with pytest.raises(SourceError) as e:
        goodjob.get("22099131")
    assert e.value.type == "schema"


def test_company_without_data_has_nulls(fake_http):
    payload = copy.deepcopy(load_company("goodjob_taxid_22099131.json"))
    c = payload["data"]["search_companies"][0]
    c.update(companyRatingStatistics=None, salary_work_time_statistics=None, companyAspectRatingStatistics=None, topNJobTitles=None)
    served(fake_http, payload)
    d = goodjob.get("22099131", include_reviews=False)["data"]
    assert d["rating"] is None and d["avg_week_work_time"] is None and d["aspect_ratings"] == [] and d["top_job_titles"] == []


# ---------- 評論 ----------
def test_reviews_default_on_with_limit_variable(fake_http):
    served(fake_http)
    out = goodjob.get("22099131", review_limit=7)
    assert fake_http.calls[0]["json"]["variables"] == {"q": "22099131", "n": 7}
    r = out["reviews"]
    assert "第三方" in r["notice"] and r["interview_total"] == 3544 and r["work_total"] > 0
    iv = r["interviews"][0]
    assert set(iv) == {"source", "url", "job_title", "region", "experience_years", "interview_date", "result", "posted", "rating", "sections"}
    assert iv["source"] == "goodjob" and iv["interview_date"] == "2026-11" and iv["posted"] == "2026-11-11" and iv["sections"][0]["title"] and iv["sections"][0]["content"]
    wk = r["work"][0]
    assert {"week_work_time", "recommend"} <= set(wk)


def test_review_limit_applied_even_if_server_returns_more(fake_http):
    served(fake_http)
    out = goodjob.get("22099131", review_limit=1)
    assert len(out["reviews"]["interviews"]) == 1 and len(out["reviews"]["work"]) == 1


def test_reviews_off_sends_no_review_fields(fake_http):
    served(fake_http)
    out = goodjob.get("22099131", include_reviews=False)
    q = sent_query(fake_http)
    assert "interviewExperiences" not in q and "workExperiences" not in q and "$n" not in q
    assert "reviews" not in out
    assert fake_http.calls[0]["json"]["variables"] == {"q": "22099131"}


@pytest.mark.parametrize("flag", [True, False])
def test_query_never_contains_personal_fields(fake_http, flag):
    served(fake_http)
    goodjob.get("22099131", include_reviews=flag)
    q = sent_query(fake_http)
    for word in FORBIDDEN:
        assert word not in q, word
    assert not re.search(r"\b(ip|IP)\b", q)


def test_long_section_text_is_clipped(fake_http):
    payload = copy.deepcopy(load_company("goodjob_taxid_22099131.json"))
    payload["data"]["search_companies"][0]["interviewExperiencesResult"]["interviewExperiences"][0]["sections"][0]["content"] = "字" * 2000
    served(fake_http, payload)
    c = goodjob.get("22099131")["reviews"]["interviews"][0]["sections"][0]["content"]
    assert 600 <= len(c) <= 601 and c.endswith("…")


def test_unknown_extra_fields_are_dropped(fake_http):
    payload = copy.deepcopy(load_company("goodjob_taxid_22099131.json"))
    e = payload["data"]["search_companies"][0]["interviewExperiencesResult"]["interviewExperiences"][0]
    e.update(gender="male", education="碩士", author="王小明", ip="1.2.3.4")
    served(fake_http, payload)
    iv = goodjob.get("22099131")["reviews"]["interviews"][0]
    assert "male" not in str(iv) and "王小明" not in str(iv) and "1.2.3.4" not in str(iv) and "碩士" not in str(iv)
