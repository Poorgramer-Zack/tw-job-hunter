import asyncio

from conftest import FakeResponse, load
from tw_job_hunter import server


def test_tools_registered():
    tools = asyncio.run(server.mcp.list_tools())
    assert {t.name for t in tools} == {"job104_search", "job104_job_detail", "company_research"}


def test_company_research_description_mentions_limits():
    tool = next(t for t in asyncio.run(server.mcp.list_tools()) if t.name == "company_research")
    d = tool.description
    assert "第三方" in d and "review_limit" in d and "include_reviews" in d and "統編" in d


def test_company_research_invalid_input_is_structured_error():
    out = server.company_research("   ")
    assert out["error"]["type"] == "invalid_input"
    assert server.company_research("22099131", review_limit=0)["error"]["type"] == "invalid_input"


def test_company_research_passes_options_and_env_key(monkeypatch):
    seen = {}

    def fake_run(query, include_reviews, review_limit, tavily_key):
        seen.update(query=query, include_reviews=include_reviews, review_limit=review_limit, tavily_key=tavily_key)
        return {"ok": True}

    monkeypatch.setattr(server.research, "run", fake_run)
    monkeypatch.setenv("TAVILY_API_KEY", "tvly-env")
    assert server.company_research("台積電", include_reviews=False, review_limit=5) == {"ok": True}
    assert seen == {"query": "台積電", "include_reviews": False, "review_limit": 5, "tavily_key": "tvly-env"}


def test_company_research_without_env_key(monkeypatch):
    seen = {}
    monkeypatch.setattr(server.research, "run", lambda query, include_reviews, review_limit, tavily_key: seen.update(k=tavily_key) or {})
    monkeypatch.delenv("TAVILY_API_KEY", raising=False)
    server.company_research("22099131")
    assert seen["k"] is None


def test_blocked_returns_structured_error(fake_get):
    fake_get(FakeResponse(status=403, body="<html>"))
    out = server.job104_job_detail("8u9za")
    assert out["error"]["type"] == "blocked" and "403" in out["error"]["message"]


def test_invalid_input_returns_structured_error():
    out = server.job104_search(keyword="x", remote="hybrid")
    assert out["error"]["type"] == "invalid_input" and "full, partial, any" in out["error"]["message"]


def test_search_ok(fake_get):
    fake_get(FakeResponse(json_data=load("search.json")))
    out = server.job104_search(keyword="python")
    assert out["total"] == 1001 and "error" not in out
