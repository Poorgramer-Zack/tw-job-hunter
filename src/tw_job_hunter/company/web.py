"""Tavily 搜尋 Dcard 與 PTT（選用）。不直接對這兩個站發出請求。"""
from tavily import TavilyClient

from .common import clip

DOMAINS = ["dcard.tw", "ptt.cc"]
MAX_RESULTS = 10
SNIPPET_LEN = 300
NO_KEY_NOTE = "未設定 Tavily 金鑰，略過 Dcard 與 PTT 的搜尋；請見 links 自行查看，或到 https://app.tavily.com 申請免費金鑰後在 plugin 設定中填入。"


def _usable(key: str | None) -> bool:
    k = (key or "").strip()
    return bool(k) and not k.startswith("${")  # 空字串與未展開的佔位字串都視為沒有金鑰


def search(name: str, api_key: str | None) -> dict:
    if not _usable(api_key):
        return {"status": "skipped", "results": [], "note": NO_KEY_NOTE}
    try:
        resp = TavilyClient(api_key=api_key.strip()).search(
            f"{name} 面試 薪水 評價", search_depth="basic", include_domains=DOMAINS, max_results=MAX_RESULTS
        )
        raw = resp.get("results") or []
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
