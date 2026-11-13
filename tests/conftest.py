import json
from pathlib import Path

import pytest

from tw_job_hunter.job104 import client, codes

FIXTURES = Path(__file__).parent / "fixtures"


def load(name: str):
    return json.loads((FIXTURES / name).read_text(encoding="utf-8"))


class FakeResponse:
    def __init__(self, status=200, body="", json_data=None, content_type=None):
        self.status_code = status
        self._json = json_data
        self.text = body if json_data is None else json.dumps(json_data)
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


@pytest.fixture
def offline_codes(monkeypatch):
    """codes 模組直接讀 fixture，不打網路。"""
    tables = {codes.AREA_URL: load("Area.json"), codes.JOBCAT_URL: load("JobCat.json")}
    monkeypatch.setattr(codes, "get_json", lambda url, params=None, referer=None: tables[url])
