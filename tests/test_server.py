import asyncio

from conftest import FakeResponse, load
from tw_job_hunter import server


def test_tools_registered():
    tools = asyncio.run(server.mcp.list_tools())
    assert {t.name for t in tools} == {"job104_search", "job104_job_detail"}


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
