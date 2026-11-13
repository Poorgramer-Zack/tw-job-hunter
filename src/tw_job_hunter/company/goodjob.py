"""GoodJob 職場透明化運動（非官方 GraphQL）：統計 + 選用的最新評論。

個資防線：評論只選取白名單欄位，不選性別、學歷、產業、職級或任何作者欄位。
"""
from urllib.parse import quote

from tw_job_hunter.company.common import NOTICE, clip
from tw_job_hunter.company.http import SourceError, graphql

SOURCE = "GoodJob"
URL = "https://api.goodjob.life/graphql"
HEADERS = {"Content-Type": "application/json"}

_STATS = """
 id name businessNumber dataCount experienceCount salaryWorkTimeCount
 salary_work_time_statistics{count average_week_work_time average_estimated_hourly_wage
  overtime_frequency_count{seldom sometimes usually almost_everyday}
  has_overtime_salary_count{yes no unknown} is_overtime_salary_legal_count{yes no unknown} has_compensatory_dayoff_count{yes no unknown}}
 companyRatingStatistics{averageRating ratingCount ratingDistribution{rating count}}
 companyAspectRatingStatistics{aspect averageRating ratingCount}
 topNJobTitles{all{name}}"""

# 白名單：評論只取這些欄位
_REVIEWS = """
 interviewExperiencesResult(start:0,limit:$n){count interviewExperiences{id job_title{name} region experience_in_year interview_time{year month} interview_result created_at averageSectionRating sections{subtitle content}}}
 workExperiencesResult(start:0,limit:$n){count workExperiences{id job_title{name} region experience_in_year data_time{year month} week_work_time recommend_to_others created_at averageSectionRating sections{subtitle content}}}"""


def _query(include_reviews: bool) -> str:
    decl = "$q:String!" + (",$n:Int!" if include_reviews else "")
    return f"query({decl}){{search_companies(query:$q,hasData:false,limit:5){{{_STATS}{_REVIEWS if include_reviews else ''}}}}}"


def _ym(d: dict | None) -> str | None:
    return f"{d['year']}-{int(d['month']):02d}" if d and d.get("year") and d.get("month") else None


def _sections(e: dict) -> list[dict]:
    return [{"title": s.get("subtitle"), "content": clip(s.get("content"))} for s in e.get("sections") or []]


def _common(e: dict) -> dict:
    return {
        "source": "goodjob",
        "url": f"https://www.goodjob.life/experiences/{e['id']}",
        "job_title": (e.get("job_title") or {}).get("name"),
        "region": e.get("region"),
        "experience_years": e.get("experience_in_year"),
        "posted": (e.get("created_at") or "")[:10] or None,
        "rating": e.get("averageSectionRating"),
        "sections": _sections(e),
    }


def _interview(e: dict) -> dict:
    return {**_common(e), "interview_date": _ym(e.get("interview_time")), "result": e.get("interview_result")}


def _work(e: dict) -> dict:
    return {**_common(e), "work_date": _ym(e.get("data_time")), "week_work_time": e.get("week_work_time"), "recommend": e.get("recommend_to_others")}


def get(tax_id: str, include_reviews: bool = True, review_limit: int = 20) -> dict:
    variables: dict = {"q": tax_id}
    if include_reviews:
        variables["n"] = review_limit
    companies = graphql(SOURCE, URL, _query(include_reviews), variables, "search_companies", HEADERS)
    if companies is None:
        raise SourceError("schema", "GoodJob 的 search_companies 為空，格式可能已改變")
    # 查無統編時 GoodJob 會回使用者亂填的假公司，必須用統編再過濾一次
    hits = [c for c in companies if c.get("businessNumber") == tax_id]
    if not hits:
        return {"status": "not_found"}
    c = hits[0]
    st = c.get("salary_work_time_statistics") or {}
    rt = c.get("companyRatingStatistics")
    out = {
        "status": "ok",
        "data": {
            "tax_id": tax_id,
            "name": c.get("name"),
            "url": "https://www.goodjob.life/companies/" + quote(c.get("name") or "", safe=""),
            "data_count": c.get("dataCount"),
            "experience_count": c.get("experienceCount"),
            "salary_work_time_count": c.get("salaryWorkTimeCount"),
            "rating": {"average": rt["averageRating"], "count": rt["ratingCount"], "distribution": rt.get("ratingDistribution")} if rt else None,
            "aspect_ratings": [{"aspect": a["aspect"], "average": a["averageRating"], "count": a["ratingCount"]} for a in c.get("companyAspectRatingStatistics") or []],
            "avg_week_work_time": st.get("average_week_work_time"),
            "avg_hourly_wage": st.get("average_estimated_hourly_wage"),
            "overtime_frequency": st.get("overtime_frequency_count"),
            "has_overtime_pay": st.get("has_overtime_salary_count"),
            "has_compensatory_dayoff": st.get("has_compensatory_dayoff_count"),
            "top_job_titles": [t["name"] for t in ((c.get("topNJobTitles") or {}).get("all") or [])],
        },
    }
    if include_reviews:
        iv = c.get("interviewExperiencesResult") or {}
        wk = c.get("workExperiencesResult") or {}
        out["reviews"] = {
            "notice": NOTICE,
            "interview_total": iv.get("count"),
            "work_total": wk.get("count"),
            "interviews": [_interview(e) for e in (iv.get("interviewExperiences") or [])[:review_limit]],
            "work": [_work(e) for e in (wk.get("workExperiences") or [])[:review_limit]],
        }
    return out
