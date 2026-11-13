"""104 職缺搜尋：使用者選項 -> 104 query；104 JSON -> 精簡職缺清單。參數語意見 design.md 的實測表。"""
from . import codes
from .client import Schema104Error, get_json

SEARCH_URL = "https://www.104.com.tw/jobs/search/api/jobs"
SEARCH_PAGE = "https://www.104.com.tw/jobs/search/"

REMOTE = {"full": "1", "partial": "2", "any": "1,2"}
ORDER = {"relevance": 15, "newest": 16, "salary": 13}
SALARY_TYPE = {"monthly": "M", "yearly": "Y"}
JOB_TYPE = {"full_time": 1, "part_time": 2}
REMOTE_TYPE = {1: "full", 2: "partial"}
SUMMARY_LEN = 150
NO_UPPER_LIMIT = 9999999  # 104 用此值表示薪資無上限


def _choice(value, table: dict, label: str):
    if value not in table:
        raise ValueError(f"{label} 只接受：{', '.join(table)}，收到「{value}」")
    return table[value]


def build_params(
    keyword: str,
    page: int = 1,
    areas: list[str] | None = None,
    remote: str | None = None,
    salary_min: int | None = None,
    salary_type: str = "monthly",
    job_categories: list[str] | None = None,
    job_type: str | None = None,
    order: str = "relevance",
) -> dict:
    if not keyword or not keyword.strip():
        raise ValueError("keyword 不可為空")
    if page < 1:
        raise ValueError("page 必須 >= 1")
    params = {"keyword": keyword.strip(), "page": page, "pagesize": 20, "order": _choice(order, ORDER, "order")}
    if areas:
        params["area"] = ",".join(codes.area_code(a) for a in areas)
    if remote is not None:
        params["remoteWork"] = _choice(remote, REMOTE, "remote")
    if salary_min is not None:
        if salary_min <= 0:
            raise ValueError("salary_min 必須是正整數")
        params.update(scmin=salary_min, sctp=_choice(salary_type, SALARY_TYPE, "salary_type"), scstrict=1)
    if job_categories:
        params["jobcat"] = ",".join(codes.jobcat_code(c) for c in job_categories)
    if job_type is not None:
        params["ro"] = _choice(job_type, JOB_TYPE, "job_type")
    return params


def _salary(low: int, high: int) -> str:
    if not low and not high:
        return "面議"
    if not high or high >= NO_UPPER_LIMIT:
        return f"{low}以上"
    return f"{low}~{high}"


def _job(j: dict) -> dict:
    url = (j.get("link") or {}).get("job", "")
    desc = (j.get("description") or "").strip()
    return {
        "job_code": url.rstrip("/").split("/")[-1].split("?")[0],
        "title": j.get("jobName"),
        "company": j.get("custName"),
        "company_code": j.get("custNo"),
        "area": j.get("jobAddrNoDesc"),
        "salary": _salary(j.get("salaryLow") or 0, j.get("salaryHigh") or 0),
        "salary_low": j.get("salaryLow"),
        "salary_high": j.get("salaryHigh"),
        "remote": REMOTE_TYPE.get(j.get("remoteWorkType"), "none"),
        "url": url,
        "posted": j.get("appearDate"),
        "summary": desc[:SUMMARY_LEN] + ("…" if len(desc) > SUMMARY_LEN else ""),
    }


def normalize(payload: dict) -> dict:
    data = payload.get("data") if isinstance(payload, dict) else None
    pag = (payload.get("metadata") or {}).get("pagination") if isinstance(payload, dict) else None
    if not isinstance(data, list) or not isinstance(pag, dict):
        raise Schema104Error("搜尋回應缺少 data 或 metadata.pagination，104 回應格式可能已改變")
    return {
        "total": pag.get("total"),
        "page": pag.get("currentPage"),
        "last_page": pag.get("lastPage"),
        "jobs": [_job(j) for j in data],
    }


def search(**options) -> dict:
    params = build_params(**options)
    out = normalize(get_json(SEARCH_URL, params, referer=SEARCH_PAGE))
    remote = options.get("remote")
    if remote:  # 104 會在結果中塞入不符篩選的廣告職缺，這裡依遠端條件再過濾一次
        allowed = {"full", "partial"} if remote == "any" else {remote}
        out["jobs"] = [j for j in out["jobs"] if j["remote"] in allowed]
    return out
