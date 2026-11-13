"""Tavily 搜尋 Dcard 與 PTT（選用）。不直接對這兩個站發出請求。"""
import re

from tavily import TavilyClient

from tw_job_hunter.company.common import clip

DOMAINS = ["dcard.tw", "ptt.cc"]
FETCH_RESULTS = 20  # Tavily 只能依網域過濾，同網域的股票版、心情版等會混進來，所以多取一些再依看板過濾
MAX_RESULTS = 10
SNIPPET_LEN = 300
# 網站 -> (從網址取出看板名稱的規則, 求職相關的看板)
_SITES = {
    "ptt": (re.compile(r"ptt\.cc/bbs/([^/]+)/", re.I), {"tech_job", "salary", "soft_job", "changejob"}),
    "dcard": (re.compile(r"dcard\.tw/f/([^/]+)/p/", re.I), {"job", "tech_job"}),
}
NO_KEY_NOTE = "未設定 Tavily 金鑰，略過 Dcard 與 PTT 的搜尋；請見 links 自行查看，或到 https://app.tavily.com 申請免費金鑰後在 plugin 設定中填入。"


def _site(url: str) -> str | None:
    """求職相關看板的文章回傳網站名稱，其他（無關看板、非文章頁）回傳 None。"""
    for site, (pattern, boards) in _SITES.items():
        m = pattern.search(url)
        if m and m.group(1).lower() in boards:
            return site
    return None


def search(name: str, api_key: str | None) -> dict:
    if not api_key:
        return {"status": "skipped", "results": [], "note": NO_KEY_NOTE}
    try:
        resp = TavilyClient(api_key=api_key).search(
            f'"{name}" 面試 薪水 評價', search_depth="basic", include_domains=DOMAINS, max_results=FETCH_RESULTS, exact_match=True
        )
        hits = [(site, r) for r in resp.get("results") or [] if (site := _site(r["url"]))]
        return {
            "status": "ok",
            "truncated": len(hits) > MAX_RESULTS,
            "results": [
                {"source": site, "title": r.get("title"), "url": r["url"], "snippet": clip(r.get("content") or "", SNIPPET_LEN)}
                for site, r in hits[:MAX_RESULTS]
            ],
        }
    except Exception as e:  # SDK 的錯誤型別很多（額度、金鑰、網路），一律降級成 error
        return {"status": "error", "results": [], "error": {"type": "web_search", "message": str(e)[:200]}}
