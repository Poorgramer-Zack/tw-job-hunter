"""面試趣：只取公開的彙總數字與連結，不取任何心得內容。

不呼叫 /search、/auth/、/c/{id}/interviews 及帶 sort/position/area 的路徑（robots.txt 禁止），不登入、不解鎖。
面試趣不支援用統編搜尋：用名稱呼叫自動完成 API，再比對回傳的 code（統編）。
"""
import json
import re
from html.parser import HTMLParser

from tw_job_hunter.company.common import short_name
from tw_job_hunter.company.http import SourceError, request

SOURCE = "面試趣"
BASE = "https://interview.tw"
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36"
XHR = {"User-Agent": UA, "Accept": "application/json", "X-Requested-With": "XMLHttpRequest"}
PAGE = {"User-Agent": UA, "Accept-Language": "zh-TW,zh;q=0.9"}
LABELS = {
    "面試心得": "interview_count", "面試評價": "rating", "錄取率": "offer_rate",
    "面試難度": "difficulty", "平均月薪": "avg_monthly_salary", "薪水情報": "salary_reports",
}
_VOID = {"br", "img", "input", "meta", "link", "hr", "source", "wbr"}


class _InfoItems(HTMLParser):
    """只讀 .iw_info-item 內 .iw_main-info（數值）與 .iw_sub-info（標籤）的文字；其他內容一律忽略。"""

    def __init__(self):
        super().__init__()
        self.items: list[dict] = []
        self._stack: list[str] = []
        self._item_depth: int | None = None
        self._region: tuple[str, int] | None = None
        self._cur: dict = {}

    def handle_starttag(self, tag, attrs):
        if tag in _VOID:
            return
        classes = (dict(attrs).get("class") or "").split()
        self._stack.append(tag)
        depth = len(self._stack)
        if "iw_info-item" in classes and self._item_depth is None:
            self._item_depth, self._cur = depth, {"main": [], "sub": []}
        elif self._item_depth is not None and self._region is None:
            if "iw_main-info" in classes:
                self._region = ("main", depth)
            elif "iw_sub-info" in classes:
                self._region = ("sub", depth)

    def handle_endtag(self, tag):
        if tag in _VOID or not self._stack:
            return
        depth = len(self._stack)
        self._stack.pop()
        if self._region and self._region[1] == depth:
            self._region = None
        if self._item_depth == depth:
            self.items.append({k: "".join(v).strip() for k, v in self._cur.items()})
            self._item_depth = None

    def handle_data(self, data):
        if self._region and data.strip():
            self._cur[self._region[0]].append(data.strip())


def _stats(html: str) -> dict:
    p = _InfoItems()
    p.feed(html)
    out = {LABELS[i["sub"]]: i["main"] for i in p.items if i.get("sub") in LABELS}
    if not out:
        raise SourceError("schema", "面試趣公司頁找不到統計區塊，格式可能已改變")
    return out


def _json_ld_rating(html: str) -> tuple[float | None, int | None]:
    for m in re.finditer(r'<script type="application/ld\+json">(.*?)</script>', html, re.S):
        try:
            graph = json.loads(m.group(1)).get("@graph", [])
        except ValueError:
            continue
        for g in graph:
            ar = ((g.get("mainEntity") or {}).get("aggregateRating")) if g.get("@type") == "WebPage" else None
            if ar:
                return ar.get("ratingValue"), ar.get("ratingCount")
    return None, None


def get(name: str, tax_id: str) -> dict:
    ac = request(SOURCE, "GET", f"{BASE}/auto-complete/companies", params={"search": short_name(name), "limit": 5}, headers=XHR)
    rows = (ac or {}).get("source") if isinstance(ac, dict) else None
    if rows is None:
        raise SourceError("schema", "面試趣自動完成回應缺少 source，格式可能已改變")
    match = next((r for r in rows if r.get("code") == tax_id), None)
    if not match:
        return {"status": "not_found"}
    sid = match["shortId"]
    html = request(SOURCE, "GET", f"{BASE}/c/{sid}", headers=PAGE, expect="text")
    stats = _stats(html)
    if stats.get("avg_monthly_salary") in (None, "", "-"):
        sal = request(SOURCE, "GET", f"{BASE}/c/{sid}/salary-average", headers=XHR)
        stats["avg_monthly_salary"] = (sal or {}).get("display") if isinstance(sal, dict) else None
    value, count = _json_ld_rating(html)
    return {
        "status": "ok",
        "data": {
            "short_id": sid,
            "url": f"{BASE}/c/{sid}",
            "salary_url": f"https://salary.tw/c/{sid}",
            **{k: stats.get(k) for k in LABELS.values()},
            "rating_value": value,
            "review_count": count,
        },
    }
