"""公司研調各來源共用的小型 HTTP 層：逾時、錯誤分類、同來源請求間隔，不重試、不帶 cookie。"""
import threading
import time
from typing import Any

import requests

TIMEOUT = 30
MIN_INTERVAL = 2.0  # 同一來源連續請求的最短間隔（秒）
DEFAULT_HEADERS = {"User-Agent": "tw-job-hunter/0.1 (personal research)"}


class SourceError(Exception):
    """type：blocked（403/429）、http（其他 4xx/5xx）、network、schema（回應格式不符）。"""

    def __init__(self, type_: str, message: str):
        super().__init__(message)
        self.type = type_


_lock = threading.Lock()
_last: dict[str, float] = {}


def _throttle(source: str) -> None:
    with _lock:  # 持鎖 sleep：並發呼叫也依序間隔
        wait = MIN_INTERVAL - (time.monotonic() - _last.get(source, float("-inf")))
        if wait > 0:
            time.sleep(wait)
        _last[source] = time.monotonic()


def request(
    source: str,
    method: str,
    url: str,
    *,
    params: dict | None = None,
    json: Any = None,
    headers: dict | None = None,
    expect: str = "json",
    allow_empty: bool = False,
) -> Any:
    """expect="json" 回傳解析後的物件，"text" 回傳字串；allow_empty 時空 body 回傳 None（商工 API 以空 body 表示查無）。"""
    _throttle(source)
    try:
        r = requests.request(method, url, params=params, json=json, headers={**DEFAULT_HEADERS, **(headers or {})}, timeout=TIMEOUT)
    except requests.RequestException as e:
        raise SourceError("network", f"連線 {source} 失敗：{type(e).__name__}") from e
    if r.status_code in (403, 429):
        raise SourceError("blocked", f"被 {source} 阻擋（HTTP {r.status_code}），請稍後再試")
    if r.status_code >= 400:
        raise SourceError("http", f"{source} 回應錯誤（HTTP {r.status_code}）")
    if not r.content:
        if allow_empty:
            return None
        raise SourceError("schema", f"{source} 回應內容為空，格式可能已改變")
    if expect == "text":
        return r.text
    try:
        return r.json()
    except ValueError as e:
        raise SourceError("schema", f"{source} 回應不是有效的 JSON，格式可能已改變") from e
