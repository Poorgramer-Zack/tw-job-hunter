"""求職天眼通（非官方 GraphQL）：好/普/負統計 + 選用的最新評論。

個資防線：查詢只選白名單欄位；天眼通資料含發文者 IP，絕不選取。
天眼通不支援用統編搜尋：先用名稱搜尋，再以 taxId 確認是同一家。
"""
from datetime import datetime, timezone

from .common import NOTICE, clip, short_name
from .http import SourceError, request

SOURCE = "天眼通"
URL = "https://www.qollie.com/graphql"
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36",
    "Origin": "https://www.qollie.com",
    "Referer": "https://www.qollie.com/search",
}
FETCH_COMMENTS = 50  # 預設排序不是時間序，取 50 篇後在本地由新到舊排序

SEARCH = 'query S($k:String){ searchCompanies(query:{kind:"company",keyword:$k,limit:10,page:1}){ _id name taxId } }'
STAT = "query C($id:ID!){ getCompanyStat(id:$id){ good normal bad total experienced question chat } }"
COMMENTS = f"query Q($id:ID!){{ searchComments(query:{{companyId:$id,limit:{FETCH_COMMENTS},page:1}}){{ _id content pros cons judge category createdAt }} }}"


def _gql(query: str, variables: dict, key: str):
    payload = request(SOURCE, "POST", URL, json={"query": query, "variables": variables}, headers=HEADERS)
    if not isinstance(payload, dict) or payload.get("errors") or not isinstance(payload.get("data"), dict) or key not in payload["data"]:
        raise SourceError("schema", f"天眼通回應含錯誤或缺少 {key}，格式可能已改變")
    return payload["data"][key]


def _date(ms) -> str | None:
    return datetime.fromtimestamp(ms / 1000, tz=timezone.utc).date().isoformat() if ms else None


def get(name: str, tax_id: str, include_reviews: bool = True, review_limit: int = 20) -> dict:
    rows = _gql(SEARCH, {"k": short_name(name)}, "searchCompanies") or []
    match = next((r for r in rows if r.get("taxId") == tax_id), None)
    if not match:
        return {"status": "not_found"}
    cid = match["_id"]
    url = f"https://www.qollie.com/companies/{cid}"
    stat = _gql(STAT, {"id": cid}, "getCompanyStat") or {}
    out = {
        "status": "ok",
        "data": {"company_id": cid, "url": url, **{k: stat.get(k) for k in ("good", "normal", "bad", "total", "experienced", "question", "chat")}},
    }
    if include_reviews:
        comments = _gql(COMMENTS, {"id": cid}, "searchComments") or []
        comments = sorted(comments, key=lambda c: c.get("createdAt") or 0, reverse=True)[:review_limit]
        out["reviews"] = {
            "notice": NOTICE,
            "items": [
                {
                    "source": "qollie",
                    "url": url,
                    "judge": c.get("judge"),
                    "category": c.get("category"),
                    "content": clip(c.get("content")),
                    "pros": clip(c.get("pros")),
                    "cons": clip(c.get("cons")),
                    "posted": _date(c.get("createdAt")),
                }
                for c in comments
            ],
        }
    return out
