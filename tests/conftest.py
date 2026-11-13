import json
from pathlib import Path

import pytest

from tw_job_hunter.job104 import client, codes

FIXTURES = Path(__file__).parent / "fixtures"


def load(name: str):
    return json.loads((FIXTURES / name).read_text(encoding="utf-8"))


def load_company(name: str):
    p = FIXTURES / "company" / name
    return p.read_text(encoding="utf-8") if name.endswith(".html") else json.loads(p.read_text(encoding="utf-8"))


class FakeResponse:
    def __init__(self, status=200, body="", json_data=None, content_type=None):
        self.status_code = status
        self._json = json_data
        self.text = body if json_data is None else json.dumps(json_data)
        self.content = self.text.encode("utf-8")
        self.headers = {"content-type": content_type or ("application/json" if json_data is not None else "text/html; charset=UTF-8")}

    def json(self):
        if self._json is None:
            raise ValueError("not json")
        return self._json


@pytest.fixture(autouse=True)
def no_throttle(monkeypatch):
    """測試不真的睡 1 秒；節流本身在 test_client 另外驗證。"""
    monkeypatch.setattr(client.time, "sleep", lambda s: None)
    codes._cache.clear()


@pytest.fixture
def fake_get(monkeypatch):
    """把 requests.get 換成回傳預設回應的假函式，並記錄呼叫。"""
    calls = []

    def install(response_for):
        def _get(url, params=None, headers=None, timeout=None, **kw):
            calls.append({"url": url, "params": params, "headers": headers, "timeout": timeout, "kw": kw})
            return response_for(url) if callable(response_for) else response_for

        monkeypatch.setattr(client.requests, "get", _get)
        return calls

    return install


@pytest.fixture(autouse=True)
def reset_company_http():
    """company.http 的同來源間隔記錄是模組層級狀態，每個測試前清掉。"""
    try:
        from tw_job_hunter.company import http
    except ImportError:  # 尚未實作時，其他測試不受影響
        yield
        return
    http._last.clear()
    yield


class FakeHTTP:
    """攔截 company.http 發出的所有請求，依序比對路由；沒有路由就讓測試失敗。"""

    def __init__(self):
        self.calls = []
        self.routes = []

    def add(self, match, response):
        """match：URL 子字串，或 (method, 子字串)；response：FakeResponse 或會被呼叫的函式。"""
        self.routes.append((match, response))

    def __call__(self, method, url, params=None, json=None, headers=None, timeout=None, **kw):
        self.calls.append({"method": method, "url": url, "params": params, "json": json, "headers": headers, "timeout": timeout})
        for match, response in self.routes:
            m, sub = match if isinstance(match, tuple) else (None, match)
            if (m is None or m == method) and sub in url:
                return response(self.calls[-1]) if callable(response) else response
        raise AssertionError(f"unexpected request: {method} {url} {params}")


@pytest.fixture
def fake_http(monkeypatch):
    from tw_job_hunter.company import http

    f = FakeHTTP()
    monkeypatch.setattr(http.requests, "request", f)
    return f


@pytest.fixture
def offline_codes(monkeypatch):
    """codes 模組直接讀 fixture，不打網路。"""
    tables = {codes.AREA_URL: load("Area.json"), codes.JOBCAT_URL: load("JobCat.json")}
    monkeypatch.setattr(codes, "get_json", lambda url, params=None, referer=None: tables[url])
