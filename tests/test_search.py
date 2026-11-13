import pytest

from conftest import FakeResponse, load
from tw_job_hunter.job104 import search
from tw_job_hunter.job104.client import Schema104Error

pytestmark = pytest.mark.usefixtures("offline_codes")


def test_build_params_minimal():
    assert search.build_params("python") == {"keyword": "python", "page": 1, "pagesize": 20, "order": 15}


def test_build_params_full():
    p = search.build_params(
        "python", page=2, areas=["台北市", "板橋"], remote="full", salary_min=60000, salary_type="monthly",
        job_categories=["軟體工程師"], job_type="full_time", order="newest",
    )
    assert p == {
        "keyword": "python", "page": 2, "pagesize": 20, "order": 16,
        "area": "6001001000,6001002003", "remoteWork": "1",
        "scmin": 60000, "sctp": "M", "scstrict": 1,
        "jobcat": "2007001004", "ro": 1,
    }


def test_yearly_and_partial():
    p = search.build_params("x", remote="partial", salary_min=1000000, salary_type="yearly", job_type="part_time", order="salary")
    assert p["remoteWork"] == "2" and p["sctp"] == "Y" and p["ro"] == 2 and p["order"] == 13


@pytest.mark.parametrize("kw,msg", [
    (dict(keyword=""), "keyword"),
    (dict(keyword="x", page=0), "page"),
    (dict(keyword="x", remote="hybrid"), "remote 只接受：full, partial, any"),
    (dict(keyword="x", salary_min=0), "salary_min"),
    (dict(keyword="x", salary_min=1, salary_type="daily"), "salary_type 只接受"),
    (dict(keyword="x", job_type="intern"), "job_type 只接受"),
    (dict(keyword="x", order="hot"), "order 只接受"),
    (dict(keyword="x", areas=["火星"]), "無法辨識的地區"),
])
def test_build_params_rejects(kw, msg):
    with pytest.raises(ValueError, match=msg):
        search.build_params(**kw)


def test_normalize_fixture():
    out = search.normalize(load("search.json"))
    assert out["total"] == 1001 and out["page"] == 1 and out["last_page"] == 150
    assert len(out["jobs"]) == 22
    j = out["jobs"][2]
    assert j["job_code"] == "8tgv1" and j["title"] == "Python工程師" and j["company"] == "指南動力有限公司"
    assert j["area"] == "台北市信義區" and j["salary"] == "面議" and j["remote"] == "none"
    assert j["url"] == "https://www.104.com.tw/job/8tgv1" and j["posted"] == "20261109"
    assert set(j) == {"job_code", "title", "company", "company_code", "area", "salary", "salary_low", "salary_high", "remote", "url", "posted", "summary"}
    assert all(len(x["summary"]) <= search.SUMMARY_LEN + 1 for x in out["jobs"])


def test_salary_text():
    assert search._salary(0, 0) == "面議"
    assert search._salary(50000, 0) == "50000以上"
    assert search._salary(40000, 60000) == "40000~60000"
    assert search._salary(80000, 9999999) == "80000以上"  # 104 用 9999999 表示無上限


def test_remote_mapping():
    base = {"link": {"job": "https://www.104.com.tw/job/abc1"}}
    assert search._job({**base, "remoteWorkType": 1})["remote"] == "full"
    assert search._job({**base, "remoteWorkType": 2})["remote"] == "partial"


def test_empty_result():
    out = search.normalize({"data": [], "metadata": {"pagination": {"total": 0, "currentPage": 1, "lastPage": 0}}})
    assert out == {"total": 0, "page": 1, "last_page": 0, "jobs": []}


def test_schema_changed():
    with pytest.raises(Schema104Error):
        search.normalize({"items": []})


def test_search_end_to_end(fake_get):
    calls = fake_get(FakeResponse(json_data=load("search.json")))
    out = search.search(keyword="python")
    assert calls[0]["url"] == search.SEARCH_URL
    assert calls[0]["headers"]["Referer"] == search.SEARCH_PAGE
    assert out["total"] == 1001 and len(out["jobs"]) == 22


def _payload(*remote_types):
    return {"data": [{"link": {"job": f"https://www.104.com.tw/job/j{i}"}, "remoteWorkType": t} for i, t in enumerate(remote_types)],
            "metadata": {"pagination": {"total": 9, "currentPage": 1, "lastPage": 1}}}


@pytest.mark.parametrize("remote,expected", [("full", {"full"}), ("partial", {"partial"}), ("any", {"full", "partial"})])
def test_remote_filter_drops_ads(fake_get, remote, expected):
    calls = fake_get(FakeResponse(json_data=_payload(0, 1, 2, 0, 1)))
    out = search.search(keyword="python", remote=remote)
    assert calls[0]["params"]["remoteWork"] == search.REMOTE[remote]
    assert out["jobs"] and {j["remote"] for j in out["jobs"]} == expected
