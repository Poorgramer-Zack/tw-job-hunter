"""對 104 發出請求的唯一入口：固定標頭、全域節流、被擋偵測、錯誤分類。

transport 用 requests：2026-11-13 實測 httpx 與 curl_cffi 都會被 Cloudflare 擋下，只有 requests 可用。
"""
import threading
import time

import requests

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36",
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "zh-TW,zh;q=0.9",
}
TIMEOUT = 20
MIN_INTERVAL = 1.0


class Job104Error(Exception):
    type = "error"


class Blocked104Error(Job104Error):
    type = "blocked"


class Network104Error(Job104Error):
    type = "network"


class Schema104Error(Job104Error):
    type = "schema"


class NotFound104Error(Job104Error):
    type = "not_found"


_lock = threading.Lock()
_last = 0.0


def _throttle():
    global _last
    with _lock:  # 持有鎖時 sleep，讓並發呼叫也依序間隔
        wait = MIN_INTERVAL - (time.monotonic() - _last)
        if wait > 0:
            time.sleep(wait)
        _last = time.monotonic()


def get_json(url: str, params: dict | None = None, referer: str | None = None) -> dict:
    _throttle()
    headers = {**HEADERS, **({"Referer": referer} if referer else {})}
    try:
        r = requests.get(url, params=params, headers=headers, timeout=TIMEOUT)
    except requests.RequestException as e:
        raise Network104Error(f"連線 104 失敗：{type(e).__name__}") from e
    ct = r.headers.get("content-type", "")
    is_json = "json" in ct
    if r.status_code in (403, 429) or (not is_json and ("challenge-platform" in r.text or "Just a moment" in r.text)):
        raise Blocked104Error(f"被 104 阻擋（HTTP {r.status_code}），請稍後再試，不要連續重試")
    if r.status_code == 404:
        raise NotFound104Error("104 回應 404")
    if r.status_code >= 500:
        raise Network104Error(f"104 伺服器錯誤（HTTP {r.status_code}）")
    if not is_json:
        raise Schema104Error(f"104 回應不是 JSON（HTTP {r.status_code}），回應格式可能已改變")
    try:
        return r.json()
    except ValueError as e:
        raise Schema104Error("104 回應的 JSON 無法解析，格式可能已改變") from e
