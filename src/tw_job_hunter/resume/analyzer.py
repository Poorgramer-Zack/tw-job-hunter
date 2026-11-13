"""適配度診斷引擎：核對求職者履歷與目標職缺 JD 的各面向條件。

只提供客觀條件符合度、優勢契合點與潛在落差，不輸出偽造的錄取率或評分。
"""
import re
from typing import Any

# 學歷階層權重
EDU_RANK = {
    "高中": 1,
    "專科": 2,
    "大學": 3,
    "碩士": 4,
    "博士": 5,
}

_YEARS_RE = re.compile(r"(\d+)\s*(?:年|y)", re.IGNORECASE)


def _extract_years(text: str) -> int | None:
    if not text:
        return None
    m = _YEARS_RE.search(text)
    return int(m.group(1)) if m else None


def _detect_edu_level(text: str) -> str | None:
    if not text:
        return None
    for edu in ["博士", "碩士", "大學", "專科", "高中"]:
        if edu in text:
            return edu
    return None


def evaluate_job_fit(resume_data: dict[str, Any], job_detail: dict[str, Any]) -> dict[str, Any]:
    """比對履歷文字與 104 職缺詳情，產出結構化核對結果。"""
    resume_text = resume_data.get("text", "")
    sections = resume_data.get("sections", {})
    reqs = job_detail.get("requirements", {})

    # 1. 硬性條件核對：學歷
    job_edu_req = reqs.get("education") or ""
    cand_edu = _detect_edu_level(resume_text)
    req_edu = _detect_edu_level(job_edu_req)

    edu_status = "unmentioned"
    if cand_edu and req_edu:
        cand_rank = EDU_RANK.get(cand_edu, 0)
        req_rank = EDU_RANK.get(req_edu, 0)
        edu_status = "met" if cand_rank >= req_rank else "unmet"
    elif cand_edu:
        edu_status = "met"

    # 2. 硬性條件核對：工作年資
    job_exp_req = reqs.get("experience") or ""
    req_years = _extract_years(job_exp_req)
    cand_years = _extract_years(resume_text)

    exp_status = "unmentioned"
    if req_years is not None and cand_years is not None:
        exp_status = "met" if cand_years >= req_years else "unmet"
    elif req_years is None:
        exp_status = "met"

    # 3. 技能標籤比對
    tools_req = reqs.get("tools") or []
    skills_req = reqs.get("skills") or []
    all_req_skills = list(dict.fromkeys(tools_req + skills_req))

    matched_skills: list[str] = []
    unmentioned_skills: list[str] = []

    resume_text_lower = resume_text.lower()
    for skill in all_req_skills:
        skill_clean = skill.strip()
        if not skill_clean:
            continue
        if skill_clean.lower() in resume_text_lower:
            matched_skills.append(skill_clean)
        else:
            unmentioned_skills.append(skill_clean)

    # 4. 優勢亮點提取（從履歷專案或經歷中比對 JD 關鍵需求）
    advantages: list[str] = []
    jd_desc = job_detail.get("description", "")
    high_value_keywords = ["架構", "重構", "高併發", "ci/cd", "效能", "優化", "微服務", "跨平台", "api", "ai"]
    for kw in high_value_keywords:
        if kw in jd_desc.lower() and kw in resume_text_lower:
            advantages.append(f"具備職缺所重視之「{kw}」相關實務背景與落地成果")
    # 去重
    advantages = list(dict.fromkeys(advantages))
    if not advantages and matched_skills:
        advantages.append(f"核心技能覆蓋良好：{', '.join(matched_skills[:5])}")

    return {
        "status": "ok",
        "job_code": job_detail.get("job_code"),
        "job_title": job_detail.get("title"),
        "company": job_detail.get("company"),
        "hard_criteria": {
            "education": {
                "required": job_edu_req or "不拘",
                "candidate": cand_edu or "未提及",
                "status": edu_status,
            },
            "experience": {
                "required": job_exp_req or "不拘",
                "candidate": f"{cand_years} 年" if cand_years else "未提及",
                "status": exp_status,
            },
        },
        "skills_analysis": {
            "matched_skills": matched_skills,
            "unmentioned_skills": unmentioned_skills,
        },
        "advantages": advantages,
        "notes": "本分析為客觀條件與關鍵字核對事實，請結合求職者具體作品集與專案細節作整體判斷。",
    }
