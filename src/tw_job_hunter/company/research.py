"""company_research：查各來源並組成一份結構化結果，來源之間互不影響，只給事實不給評分。"""
import re
from concurrent.futures import ThreadPoolExecutor

from tw_job_hunter.company import goodjob, interview_tw, links, qollie, registry, web
from tw_job_hunter.company.http import SourceError

MAX_REVIEW_LIMIT = 50
SKIPPED = {"status": "skipped", "reason": "公司身分（統編）未確認，不查詢此來源"}


def _safe(fn) -> dict:
    """單一來源失敗不影響其他來源；未預期的例外也一併收斂成 error。"""
    try:
        return fn()
    except SourceError as e:
        return {"status": "error", "error": {"type": e.type, "message": str(e)}}
    except Exception as e:
        return {"status": "error", "error": {"type": "internal", "message": f"{type(e).__name__}: {e}"[:200]}}


def run(query: str, include_reviews: bool = True, review_limit: int = 20, tavily_key: str | None = None) -> dict:
    query = (query or "").strip()
    if not query:
        raise ValueError("請提供公司名稱或 8 碼統編")
    if not 1 <= review_limit <= MAX_REVIEW_LIMIT:
        raise ValueError(f"review_limit 必須介於 1 到 {MAX_REVIEW_LIMIT}，收到 {review_limit}")

    tax_id = query if re.fullmatch(r"\d{8}", query) else None
    resolved = None  # 名稱解析的結果；解析失敗時它就是 company 區塊本身
    if tax_id is None:
        resolved = _safe(lambda: registry.resolve_name(query))
        if resolved["status"] == "ok":
            tax_id = resolved["tax_id"]
    company = _safe(lambda: registry.get_by_tax_id(tax_id)) if tax_id else resolved

    confirmed = company["status"] == "ok"
    name = company["data"]["name"] if confirmed else None
    search_name = name or query
    opts = {"include_reviews": include_reviews, "review_limit": review_limit}

    # 來源互相獨立，同時查；同一來源的請求間隔由 company.http 的每來源鎖保證
    calls = {"web": lambda: web.search(search_name, tavily_key)}
    if confirmed:
        calls["goodjob"] = lambda: goodjob.get(tax_id, **opts)
        calls["qollie"] = lambda: qollie.get(name, tax_id, **opts)
        calls["interview_tw"] = lambda: interview_tw.get(name, tax_id)
    with ThreadPoolExecutor(max_workers=len(calls)) as pool:
        futures = {k: pool.submit(_safe, fn) for k, fn in calls.items()}
        results = {k: f.result() for k, f in futures.items()}
    gj, ql, itw = (results.get(k, SKIPPED) for k in ("goodjob", "qollie", "interview_tw"))

    return {
        "query": {"input": query, "tax_id": tax_id if confirmed else None, "name": name},
        "company": company,
        "goodjob": gj,
        "qollie": ql,
        "interview_tw": itw,
        "web": results["web"],
        "links": links.build(
            search_name,
            goodjob_name=(gj.get("data") or {}).get("name"),
            qollie_id=(ql.get("data") or {}).get("company_id"),
            itw_short_id=(itw.get("data") or {}).get("short_id"),
        ),
    }
