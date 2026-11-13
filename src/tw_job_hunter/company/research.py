"""company_research：依序查各來源並組成一份結構化結果，來源之間互不影響，只給事實不給評分。"""
import re

from . import goodjob, interview_tw, links, qollie, registry, web
from .http import SourceError

MAX_REVIEW_LIMIT = 50
SKIP_REASON = "公司身分（統編）未確認，不查詢此來源"


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
    if tax_id is None:
        resolved = _safe(lambda: registry.resolve_name(query))
        if resolved["status"] == "ok":
            tax_id = resolved["tax_id"]
            company = _safe(lambda: registry.get_by_tax_id(tax_id))
        else:
            company = resolved  # needs_selection / not_found / error
    else:
        company = _safe(lambda: registry.get_by_tax_id(tax_id))

    confirmed = company["status"] == "ok"
    name = company["data"]["name"] if confirmed else None
    skipped = {"status": "skipped", "reason": SKIP_REASON}
    opts = {"include_reviews": include_reviews, "review_limit": review_limit}

    gj = _safe(lambda: goodjob.get(tax_id, **opts)) if confirmed else skipped
    ql = _safe(lambda: qollie.get(name, tax_id, **opts)) if confirmed else skipped
    itw = _safe(lambda: interview_tw.get(name, tax_id)) if confirmed else skipped
    search_name = name or query
    wb = _safe(lambda: web.search(search_name, tavily_key))

    return {
        "query": {"input": query, "tax_id": tax_id if confirmed else None, "name": name},
        "company": company,
        "goodjob": gj,
        "qollie": ql,
        "interview_tw": itw,
        "web": wb,
        "links": links.build(
            search_name,
            goodjob_name=(gj.get("data") or {}).get("name"),
            qollie_id=(ql.get("data") or {}).get("company_id"),
            itw_short_id=(itw.get("data") or {}).get("short_id"),
        ),
    }
