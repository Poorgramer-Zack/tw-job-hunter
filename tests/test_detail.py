import pytest

from conftest import FakeResponse, load
from tw_job_hunter.job104 import detail
from tw_job_hunter.job104.client import Schema104Error


@pytest.mark.parametrize("text", [
    "8u9za", " 8u9za ", "https://www.104.com.tw/job/8u9za", "https://www.104.com.tw/job/8u9za?jobsource=x", "www.104.com.tw/job/8u9za/",
])
def test_parse_job_code(text):
    assert detail.parse_job_code(text) == "8u9za"


@pytest.mark.parametrize("text", ["", "hello world", "https://www.104.com.tw/company/abc", "8U9ZA!"])
def test_parse_job_code_invalid(text):
    with pytest.raises(ValueError, match="職缺代碼"):
        detail.parse_job_code(text)


def test_normalize_fixture():
    d = detail.normalize(load("detail.json"), "8zf18")
    assert d["status"] == "open" and d["job_code"] == "8zf18"
    assert d["title"] == "Application Engineers" and d["company"] == "美商_國家儀器股份有限公司"
    assert d["salary"] == "待遇面議" and d["salary_min"] == 0
    assert d["categories"][0] == "軟體工程師"
    assert d["address"] == "新竹市自强路8号" and d["remote"] == "none" and d["openings"] == "1人"
    assert d["requirements"]["experience"] == "5年以上" and d["requirements"]["education"] == "大學以上"
    assert "LabVIEW" in d["requirements"]["tools"]
    assert d["welfare"]["text"].startswith("【保障員工福利】")
    assert d["url"] == "https://www.104.com.tw/job/8zf18"
    assert d["description"]


def test_missing_optional_fields_are_null():
    d = detail.normalize({"data": {"jobDetail": {}}}, "abcd")
    assert d["title"] is None and d["requirements"]["experience"] is None and d["welfare"]["text"] is None
    assert d["remote"] == "none" and d["address"] is None


def test_schema_changed():
    with pytest.raises(Schema104Error):
        detail.normalize({"data": {"header": {}}}, "abcd")


def test_closed_job(fake_get):
    fake_get(FakeResponse(status=404, json_data={"error": {"code": 11201, "message": "職務不存在"}}))
    assert detail.detail("zzzzz") == {"job_code": "zzzzz", "status": "not_found", "message": "職缺不存在或已關閉"}


def test_detail_end_to_end(fake_get):
    calls = fake_get(FakeResponse(json_data=load("detail.json")))
    out = detail.detail("https://www.104.com.tw/job/8zf18?x=1")
    assert calls[0]["url"] == "https://www.104.com.tw/job/ajax/content/8zf18"
    assert calls[0]["headers"]["Referer"] == "https://www.104.com.tw/job/8zf18"
    assert out["status"] == "open"
