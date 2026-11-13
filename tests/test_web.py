import pytest

from conftest import load_company
from tw_job_hunter.company import links, web


class FakeTavily:
    last = None
    raises = None
    payload = None

    def __init__(self, api_key=None):
        FakeTavily.last = {"api_key": api_key, "calls": []}

    def search(self, query, **kw):
        FakeTavily.last["calls"].append((query, kw))
        if FakeTavily.raises:
            raise FakeTavily.raises
        return FakeTavily.payload or load_company("tavily_search.json")


@pytest.fixture(autouse=True)
def fake_tavily(monkeypatch):
    FakeTavily.last = None
    FakeTavily.raises = None
    FakeTavily.payload = None
    monkeypatch.setattr(web, "TavilyClient", FakeTavily)


def test_search_with_key():
    out = web.search("台灣積體電路製造股份有限公司", "tvly-abc")
    assert out["status"] == "ok" and out["truncated"] is False
    q, kw = FakeTavily.last["calls"][0]
    assert "台灣積體電路製造股份有限公司" in q and kw["include_domains"] == ["dcard.tw", "ptt.cc"] and kw["max_results"] == 10 and kw["search_depth"] == "basic"
    r = out["results"][0]
    assert set(r) == {"source", "title", "url", "snippet"} and r["source"] in ("dcard", "ptt")


def test_snippet_clipped_to_300():
    p = load_company("tavily_search.json")
    p["results"][0]["content"] = "字" * 1000
    FakeTavily.payload = p
    assert len(web.search("某公司", "k")["results"][0]["snippet"]) <= 301


def test_more_than_ten_results_truncated():
    p = load_company("tavily_search.json")
    p["results"] = [dict(p["results"][0], url=f"https://www.ptt.cc/bbs/Tech_Job/M.{i}.html") for i in range(12)]
    FakeTavily.payload = p
    out = web.search("某公司", "k")
    assert len(out["results"]) == 10 and out["truncated"] is True


@pytest.mark.parametrize("key", [None, "", "   ", "${user_config.tavily_api_key}", "${TAVILY_API_KEY}"])
def test_no_usable_key_is_skipped(key):
    out = web.search("某公司", key)
    assert out["status"] == "skipped" and out["results"] == [] and "金鑰" in out["note"]
    assert FakeTavily.last is None or FakeTavily.last["calls"] == []


def test_tavily_failure_is_error():
    FakeTavily.raises = RuntimeError("quota exceeded")
    out = web.search("某公司", "k")
    assert out["status"] == "error" and out["error"]["type"] == "web_search" and "quota" in out["error"]["message"]


def test_only_dcard_and_ptt_never_requested_directly(monkeypatch):
    import requests

    def no_direct(*a, **k):
        raise AssertionError("direct HTTP request")

    monkeypatch.setattr(requests, "request", no_direct)
    monkeypatch.setattr(requests, "get", no_direct)
    assert web.search("某公司", "k")["status"] == "ok"


# ---------- links ----------
def test_links_use_known_ids():
    ln = links.build("台灣積體電路製造股份有限公司", goodjob_name="台積電 TSMC", qollie_id="abc", itw_short_id="KYRX")
    assert ln["goodjob"] == "https://www.goodjob.life/companies/%E5%8F%B0%E7%A9%8D%E9%9B%BB%20TSMC"
    assert ln["qollie"] == "https://www.qollie.com/companies/abc"
    assert ln["interview_tw"] == "https://interview.tw/c/KYRX" and ln["salary_tw"] == "https://salary.tw/c/KYRX"
    assert set(ln) == {"goodjob", "qollie", "interview_tw", "salary_tw", "dcard", "ptt"}


def test_links_fall_back_to_search_with_official_name():
    ln = links.build("台灣積體電路製造股份有限公司")
    assert "%E5%8F%B0%E7%81%A3%E7%A9%8D%E9%AB%94%E9%9B%BB%E8%B7%AF%E8%A3%BD%E9%80%A0" in ln["qollie"]
    assert all(v.startswith("https://") for v in ln.values())
    assert "dcard.tw" in ln["dcard"] and "ptt.cc" in ln["ptt"]
