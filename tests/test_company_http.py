import pytest
import requests

from conftest import FakeResponse
from tw_job_hunter.company import http
from tw_job_hunter.company.http import SourceError


def test_get_json(fake_http):
    fake_http.add("example.com", FakeResponse(json_data={"a": 1}))
    assert http.request("src", "GET", "https://example.com/x", params={"k": "v"}) == {"a": 1}
    assert fake_http.calls[0]["timeout"] == http.TIMEOUT
    assert "Cookie" not in (fake_http.calls[0]["headers"] or {})


def test_post_json_sends_body(fake_http):
    fake_http.add("example.com", FakeResponse(json_data={"ok": True}))
    http.request("src", "POST", "https://example.com/g", json={"query": "q"})
    assert fake_http.calls[0]["method"] == "POST" and fake_http.calls[0]["json"] == {"query": "q"}


def test_text_mode(fake_http):
    fake_http.add("example.com", FakeResponse(body="<html>hi</html>"))
    assert http.request("src", "GET", "https://example.com/", expect="text") == "<html>hi</html>"


def test_empty_body_is_none_when_allowed(fake_http):
    fake_http.add("example.com", FakeResponse(status=200, body=""))
    assert http.request("src", "GET", "https://example.com/", allow_empty=True) is None


def test_empty_body_is_schema_error_by_default(fake_http):
    fake_http.add("example.com", FakeResponse(status=200, body=""))
    with pytest.raises(SourceError) as e:
        http.request("src", "GET", "https://example.com/")
    assert e.value.type == "schema"


@pytest.mark.parametrize("status,kind", [(403, "blocked"), (429, "blocked"), (404, "http"), (500, "http")])
def test_error_status(fake_http, status, kind):
    fake_http.add("example.com", FakeResponse(status=status, body="x"))
    with pytest.raises(SourceError) as e:
        http.request("src", "GET", "https://example.com/")
    assert e.value.type == kind and str(status) in str(e.value)


def test_network_error(monkeypatch):
    def boom(*a, **k):
        raise requests.Timeout()

    monkeypatch.setattr(http.requests, "request", boom)
    with pytest.raises(SourceError) as e:
        http.request("src", "GET", "https://example.com/")
    assert e.value.type == "network"


def test_invalid_json_is_schema_error(fake_http):
    fake_http.add("example.com", FakeResponse(status=200, body="<html>", content_type="application/json"))
    with pytest.raises(SourceError) as e:
        http.request("src", "GET", "https://example.com/")
    assert e.value.type == "schema"


def test_same_source_spaced_two_seconds(monkeypatch, fake_http):
    fake_http.add("example.com", FakeResponse(json_data={}))
    now = [100.0]
    slept = []
    monkeypatch.setattr(http.time, "monotonic", lambda: now[0])
    monkeypatch.setattr(http.time, "sleep", lambda s: (slept.append(s), now.__setitem__(0, now[0] + s)))
    http.request("a", "GET", "https://example.com/1")
    now[0] += 0.5
    http.request("a", "GET", "https://example.com/2")
    assert slept == [pytest.approx(1.5)]


def test_different_sources_do_not_wait(monkeypatch, fake_http):
    fake_http.add("example.com", FakeResponse(json_data={}))
    slept = []
    monkeypatch.setattr(http.time, "sleep", lambda s: slept.append(s))
    http.request("a", "GET", "https://example.com/1")
    http.request("b", "GET", "https://example.com/2")
    assert slept == []
