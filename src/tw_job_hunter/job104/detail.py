"""104 職缺詳情：網址或代碼 -> 完整職缺內容。"""
import re

from .client import NotFound104Error, Schema104Error, get_json
from .search import REMOTE_TYPE

DETAIL_URL = "https://www.104.com.tw/job/ajax/content/{code}"
JOB_PAGE = "https://www.104.com.tw/job/{code}"
_CODE = re.compile(r"^[0-9a-z]{4,10}$")
_URL = re.compile(r"104\.com\.tw/job/([0-9a-z]+)")


def parse_job_code(text: str) -> str:
    text = (text or "").strip()
    m = _URL.search(text)
    code = m.group(1) if m else text
    if not _CODE.fullmatch(code):
        raise ValueError(f"無法從「{text}」解析出 104 職缺代碼，請傳入職缺網址或代碼（例如 8u9za）")
    return code


def _descs(items) -> list[str]:
    return [i.get("description") for i in (items or []) if isinstance(i, dict)]


def normalize(payload: dict, code: str) -> dict:
    d = payload.get("data") if isinstance(payload, dict) else None
    if not isinstance(d, dict) or not isinstance(d.get("jobDetail"), dict):
        raise Schema104Error("詳情回應缺少 data.jobDetail，104 回應格式可能已改變")
    h = d.get("header") or {}
    jd = d["jobDetail"]
    c = d.get("condition") or {}
    w = d.get("welfare") or {}
    return {
        "job_code": code,
        "status": "open",
        "title": h.get("jobName"),
        "company": h.get("custName"),
        "company_code": d.get("custNo"),
        "company_url": h.get("custUrl"),
        "industry": d.get("industry"),
        "posted": h.get("appearDate"),
        "description": jd.get("jobDescription"),
        "categories": _descs(jd.get("jobCategory")),
        "salary": jd.get("salary"),
        "salary_min": jd.get("salaryMin"),
        "salary_max": jd.get("salaryMax"),
        "salary_type_code": jd.get("salaryType"),
        "job_type_code": jd.get("jobType"),
        "work_type": jd.get("workType"),
        "address": f"{jd.get('addressRegion') or ''}{jd.get('addressDetail') or ''}" or None,
        "work_period": jd.get("workPeriod"),
        "vacation_policy": jd.get("vacationPolicy"),
        "remote": REMOTE_TYPE.get((jd.get("remoteWork") or {}).get("type"), "none"),
        "openings": jd.get("needEmp"),
        "requirements": {
            "experience": c.get("workExp"),
            "education": c.get("edu"),
            "majors": c.get("major"),
            "languages": c.get("language"),
            "tools": _descs(c.get("specialty")),
            "skills": _descs(c.get("skill")),
            "certificates": c.get("certificate"),
            "other": c.get("other"),
        },
        "welfare": {"tags": w.get("tag"), "text": w.get("welfare")},
        "url": JOB_PAGE.format(code=code),
    }


def detail(job: str) -> dict:
    code = parse_job_code(job)
    try:
        payload = get_json(DETAIL_URL.format(code=code), referer=JOB_PAGE.format(code=code))
    except NotFound104Error:
        return {"job_code": code, "status": "not_found", "message": "職缺不存在或已關閉"}
    return normalize(payload, code)
