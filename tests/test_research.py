import builtins
import json
from pathlib import Path

import pytest

from tw_job_hunter.company import research
from tw_job_hunter.company.http import SourceError

TAX = "22099131"
NAME = "台灣積體電路製造股份有限公司"
COMPANY = {"status": "ok", "data": {"tax_id": TAX, "name": NAME, "status": "核准設立", "capital": 1, "years_since_setup": 39}}
GOODJOB = {"status": "ok", "data": {"name": "台積電 TSMC", "url": "u"}, "reviews": {"notice": "n", "interviews": [], "work": []}}
QOLLIE = {"status": "ok", "data": {"company_id": "qid", "url": "q"}, "reviews": {"notice": "n", "items": []}}
ITW = {"status": "ok", "data": {"short_id": "KYRX", "url": "i"}}
WEB = {"status": "ok", "results": [], "truncated": False}


class Spy:
    def __init__(self, result):
        self.result, self.calls = result, []

    def __call__(self, *a, **k):
        self.calls.append((a, k))
        if isinstance(self.result, Exception):
            raise self.result
        return self.result


@pytest.fixture
def sources(monkeypatch):
    s = {
        "by_tax": Spy(COMPANY), "resolve": Spy({"status": "ok", "tax_id": TAX, "name": NAME}),
        "goodjob": Spy(GOODJOB), "qollie": Spy(QOLLIE), "itw": Spy(ITW), "web": Spy(WEB),
    }
    monkeypatch.setattr(research.registry, "get_by_tax_id", s["by_tax"])
    monkeypatch.setattr(research.registry, "resolve_name", s["resolve"])
    monkeypatch.setattr(research.goodjob, "get", s["goodjob"])
    monkeypatch.setattr(research.qollie, "get", s["qollie"])
    monkeypatch.setattr(research.interview_tw, "get", s["itw"])
    monkeypatch.setattr(research.web, "search", s["web"])
    return s


def keys_anywhere(obj, banned):
    if isinstance(obj, dict):
        return any(k in banned or keys_anywhere(v, banned) for k, v in obj.items())
    if isinstance(obj, list):
        return any(keys_anywhere(v, banned) for v in obj)
    return False


# ---------- 輸入 ----------
def test_eight_digits_is_tax_id(sources):
    out = research.run(TAX)
    assert sources["by_tax"].calls and not sources["resolve"].calls
    assert out["query"] == {"input": TAX, "tax_id": TAX, "name": NAME}


def test_name_is_resolved_then_fetched(sources):
    out = research.run(NAME)
    assert sources["resolve"].calls and sources["by_tax"].calls[0][0][0] == TAX
    assert out["company"] == COMPANY


@pytest.mark.parametrize("bad", ["", "   "])
def test_empty_input_rejected_without_requests(sources, bad):
    with pytest.raises(ValueError):
        research.run(bad)
    assert not any(s.calls for s in sources.values())


@pytest.mark.parametrize("n", [0, -1, 51, 1000])
def test_review_limit_out_of_range_rejected(sources, n):
    with pytest.raises(ValueError, match="review_limit"):
        research.run(TAX, review_limit=n)
    assert not any(s.calls for s in sources.values())


# ---------- 輸出 ----------
def test_full_success_shape(sources):
    out = research.run(TAX)
    assert set(out) == {"query", "company", "goodjob", "qollie", "interview_tw", "web", "links"}
    assert [out[k]["status"] for k in ("company", "goodjob", "qollie", "interview_tw", "web")] == ["ok"] * 5


def test_reviews_options_passed_through(sources):
    research.run(TAX, include_reviews=False, review_limit=5)
    assert sources["goodjob"].calls[0][1] == {"include_reviews": False, "review_limit": 5}
    assert sources["qollie"].calls[0][1] == {"include_reviews": False, "review_limit": 5}


def test_reviews_default_on_and_twenty(sources):
    research.run(TAX)
    assert sources["goodjob"].calls[0][1] == {"include_reviews": True, "review_limit": 20}


def test_links_use_ids_returned_by_sources(sources):
    out = research.run(TAX)
    assert out["links"]["qollie"].endswith("/qid") and out["links"]["interview_tw"].endswith("/KYRX")
    assert "TSMC" in out["links"]["goodjob"] or "%20TSMC" in out["links"]["goodjob"]


def test_web_gets_name_and_key(sources):
    research.run(TAX, tavily_key="tvly-x")
    assert sources["web"].calls[0][0] == (NAME, "tvly-x")


# ---------- 獨立性 ----------
def test_one_source_failing_does_not_break_others(sources):
    sources["goodjob"].result = SourceError("network", "連線 GoodJob 失敗：Timeout")
    out = research.run(TAX)
    assert out["goodjob"] == {"status": "error", "error": {"type": "network", "message": "連線 GoodJob 失敗：Timeout"}}
    assert out["company"]["status"] == out["qollie"]["status"] == out["interview_tw"]["status"] == "ok"


def test_unexpected_exception_is_contained(sources):
    sources["qollie"].result = RuntimeError("boom")
    out = research.run(TAX)
    assert out["qollie"]["status"] == "error" and out["qollie"]["error"]["type"] == "internal"
    assert out["goodjob"]["status"] == "ok"


def test_not_found_sources_pass_through(sources):
    sources["itw"].result = {"status": "not_found"}
    assert research.run(TAX)["interview_tw"] == {"status": "not_found"}


def test_all_sources_failing_still_returns_links(sources):
    for k in ("by_tax", "goodjob", "qollie", "itw", "web"):
        sources[k].result = SourceError("blocked", "擋")
    out = research.run(TAX)
    assert out["company"]["status"] == "error" and out["links"] and all(v.startswith("https://") for v in out["links"].values())


# ---------- 統編是共同依據 ----------
def test_ambiguous_name_needs_selection_and_skips_review_sources(sources):
    sources["resolve"].result = {"status": "needs_selection", "candidates": [{"tax_id": "1", "name": "甲", "status": "核准設立", "address": "x"}]}
    out = research.run("台積電", tavily_key="k")
    assert out["company"]["status"] == "needs_selection" and out["company"]["candidates"]
    assert [out[k]["status"] for k in ("goodjob", "qollie", "interview_tw")] == ["skipped"] * 3
    assert not (sources["goodjob"].calls or sources["qollie"].calls or sources["itw"].calls or sources["by_tax"].calls)
    assert sources["web"].calls[0][0] == ("台積電", "k") and out["links"]


def test_unresolved_name_skips_review_sources(sources):
    sources["resolve"].result = {"status": "not_found", "message": "查無"}
    out = research.run("不存在公司")
    assert out["company"]["status"] == "not_found"
    assert [out[k]["status"] for k in ("goodjob", "qollie", "interview_tw")] == ["skipped"] * 3
    assert out["query"]["tax_id"] is None


def test_tax_id_not_in_registry_skips_review_sources(sources):
    sources["by_tax"].result = {"status": "not_found"}
    out = research.run("99999999")
    assert out["company"]["status"] == "not_found"
    assert [out[k]["status"] for k in ("goodjob", "qollie", "interview_tw")] == ["skipped"] * 3


def test_registry_error_is_reported_and_skips_review_sources(sources):
    sources["resolve"].result = SourceError("network", "連線失敗")
    out = research.run(NAME)
    assert out["company"]["status"] == "error" and out["goodjob"]["status"] == "skipped"


# ---------- 只給事實 ----------
def test_no_scoring_or_recommendation_fields(sources):
    out = research.run(TAX)
    assert not keys_anywhere(out, {"score", "grade", "verdict", "recommendation", "recommend_score", "overall", "health"})


# ---------- 不落地 ----------
def test_nothing_is_written_to_disk(sources, monkeypatch):
    real_open = builtins.open

    def guarded(file, mode="r", *a, **k):
        if any(c in mode for c in "wax+"):
            raise AssertionError(f"write attempt: {file}")
        return real_open(file, mode, *a, **k)

    with monkeypatch.context() as m:
        m.setattr(builtins, "open", guarded)
        m.setattr(Path, "write_text", lambda *a, **k: (_ for _ in ()).throw(AssertionError("write_text")))
        m.setattr(Path, "write_bytes", lambda *a, **k: (_ for _ in ()).throw(AssertionError("write_bytes")))
        out = research.run(TAX)
    assert json.dumps(out, ensure_ascii=False)
