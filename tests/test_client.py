import pytest
import requests

from conftest import FakeResponse
from tw_job_hunter.job104 import client
from tw_job_hunter.job104.client import Blocked104Error, Network104Error, NotFound104Error, Schema104Error

URL = "https://www.104.com.tw/x"


def test_ok_json(fake_get):
    calls = fake_get(FakeResponse(json_data={"a": 1}))
    assert client.get_json(URL, {"k": "v"}, referer="https://www.104.com.tw/jobs/search/") == {"a": 1}
    h = calls[0]["headers"]
    assert h["Referer"] == "https://www.104.com.tw/jobs/search/"
    assert h["User-Agent"].startswith("Mozilla/5.0")
    assert calls[0]["timeout"] == client.TIMEOUT


def test_no_cookie_sent(fake_get):
    calls = fake_get(FakeResponse(json_data={}))
    client.get_json(URL)
    assert "Cookie" not in calls[0]["headers"]
    assert "cookies" not in calls[0]["kw"]


@pytest.mark.parametrize("status", [403, 429])
def test_blocked_status(fake_get, status):
    fake_get(FakeResponse(status=status, body="<html>"))
    with pytest.raises(Blocked104Error, match=str(status)):
        client.get_json(URL)


def test_challenge_page_with_200(fake_get):
    fake_get(FakeResponse(status=200, body="<html><script src='/cdn-cgi/challenge-platform/x'></script>"))
    with pytest.raises(Blocked104Error):
        client.get_json(URL)


def test_404(fake_get):
    fake_get(FakeResponse(status=404, json_data={"error": {"code": 11201, "message": "職務不存在"}}))
    with pytest.raises(NotFound104Error):
        client.get_json(URL)


def test_5xx(fake_get):
    fake_get(FakeResponse(status=502, body="bad gateway"))
    with pytest.raises(Network104Error, match="502"):
        client.get_json(URL)


def test_timeout(monkeypatch):
    def boom(*a, **k):
        raise requests.Timeout()

    monkeypatch.setattr(client.requests, "get", boom)
    with pytest.raises(Network104Error, match="Timeout"):
        client.get_json(URL)


def test_non_json_200(fake_get):
    fake_get(FakeResponse(status=200, body="<html>maintenance</html>"))
    with pytest.raises(Schema104Error):
        client.get_json(URL)


def test_throttle_spaces_requests(monkeypatch, fake_get):
    fake_get(FakeResponse(json_data={}))
    now = [100.0]
    slept = []
    monkeypatch.setattr(client.time, "monotonic", lambda: now[0])
    monkeypatch.setattr(client.time, "sleep", lambda s: (slept.append(s), now.__setitem__(0, now[0] + s)))
    client._last = 0.0
    client.get_json(URL)
    now[0] += 0.3
    client.get_json(URL)
    assert len(slept) == 1 and slept[0] == pytest.approx(0.7)
