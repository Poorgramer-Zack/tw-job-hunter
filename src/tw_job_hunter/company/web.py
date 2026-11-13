"""Tavily 搜尋 Dcard 與 PTT（選用）。不直接對這兩個站發出請求。"""
from tavily import TavilyClient

from .common import clip

import re

DOMAINS = ["dcard.tw", "ptt.cc"]
# Tavily 只能依網域過濾，同網域的股票版、心情版等會混進來，所以取回較多筆後依看板在本地過濾
FETCH_RESULTS = 20
_BOARD = re.compile(r"ptt\.cc/bbs/(?P<ptt>[^/]+)/|dcard\.tw/f/(?P<dcard>[^/]+)/p/", re.I)
_BOARDS = {"ptt": {"tech_job", "salary", "soft_job", "changejob"}, "dcard": {"job", "tech_job"}}
MAX_RESULTS = 10
SNIPPET_LEN = 300
NO_KEY_NOTE = "未設定 Tavily 金鑰，略過 Dcard 與 PTT 的搜尋；請見 links 自行查看，或到 https://app.tavily.com 申請免費金鑰後在 plugin 設定中填入。"


def _usable(key: str | None) -> bool:
    k = (key or "").strip()
    return bool(k) and not k.startswith("${")  # 空字串與未展開的佔位字串都視為沒有金鑰


def _relevant(url: str) -> bool:
    m = _BOARD.search(url)
    return bool(m) and any(m.group(site) and m.group(site).lower() in boards for site, boards in _BOARDS.items())


def search(name: str, api_key: str | None) -> dict:
    if not _usable(api_key):
        return {"status": "skipped", "results": [], "note": NO_KEY_NOTE}
    try:
        resp = TavilyClient(api_key=api_key.strip()).search(
            f'"{name}" 面試 薪水 評價', search_depth="basic", include_domains=DOMAINS, max_results=FETCH_RESULTS, exact_match=True
        )
        raw = [r for r in resp.get("results") or [] if _relevant(r["url"])]
        return {
            "status": "ok",
            "truncated": len(raw) > MAX_RESULTS,
            "results": [
                {"source": "dcard" if "dcard.tw" in r["url"] else "ptt", "title": r.get("title"), "url": r["url"], "snippet": clip(r.get("content") or "", SNIPPET_LEN)}
                for r in raw[:MAX_RESULTS]
            ],
        }
    except Exception as e:  # SDK 的錯誤型別很多（額度、金鑰、網路），一律降級成 error
        return {"status": "error", "results": [], "error": {"type": "web_search", "message": str(e)[:200]}}
