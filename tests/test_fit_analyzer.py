from tw_job_hunter.resume import analyzer

MOCK_JOB_DETAIL = {
    "status": "open",
    "job_code": "test_job_1",
    "title": "資深 Python 後端工程師",
    "company": "示範科技股份有限公司",
    "requirements": {
        "education": "大學以上",
        "experience": "3年以上",
        "tools": ["Python", "FastAPI", "PostgreSQL", "CI/CD", "Docker"],
        "skills": ["系統架構規劃", "軟體工程系統開發"],
        "other": "具備高併發系統架構與效能優化經驗者佳",
    },
    "description": "我們正在尋找負責核心訂單服務架構規劃與資料庫效能優化的後端夥伴。",
}

MOCK_RESUME_DATA = {
    "status": "ok",
    "text": "工作經歷：後端工程師，擁有 4 年工作經驗。畢業於國立示範大學資訊系學士。\n精通 Python、FastAPI、PostgreSQL 與 CI/CD 流程自動化。\n主導核心訂單系統架構重構與查詢效能優化。",
    "sections": {
        "experience": "後端工程師 4 年經驗，主導核心訂單系統架構重構",
        "skills": "Python, FastAPI, PostgreSQL, CI/CD",
        "education": "國立示範大學 資訊工程學系 學士",
    },
}


def test_analyze_fit_hard_criteria_education_and_experience():
    result = analyzer.evaluate_job_fit(MOCK_RESUME_DATA, MOCK_JOB_DETAIL)
    assert result["status"] == "ok"
    hard = result["hard_criteria"]

    assert hard["education"]["status"] == "met"
    assert "大學" in hard["education"]["candidate"]
    assert hard["experience"]["status"] == "met"


def test_analyze_fit_skills_matching_and_missing():
    result = analyzer.evaluate_job_fit(MOCK_RESUME_DATA, MOCK_JOB_DETAIL)
    skills = result["skills_analysis"]

    matched = [s.lower() for s in skills["matched_skills"]]
    assert "python" in matched
    assert "fastapi" in matched
    assert "postgresql" in matched

    unmentioned = [s.lower() for s in skills["unmentioned_skills"]]
    assert "docker" in unmentioned


def test_analyze_fit_highlights_key_advantages():
    result = analyzer.evaluate_job_fit(MOCK_RESUME_DATA, MOCK_JOB_DETAIL)
    advantages = result["advantages"]
    assert len(advantages) > 0
    assert any("架構" in a or "優化" in a or "效能" in a for a in advantages)


def test_no_fake_percentage_score():
    result = analyzer.evaluate_job_fit(MOCK_RESUME_DATA, MOCK_JOB_DETAIL)
    banned_keys = {"score", "match_rate", "percentage", "probability", "success_rate", "錄取率"}
    for key in banned_keys:
        assert key not in result
        assert key not in result.get("hard_criteria", {})


def test_analyze_fit_with_missing_resume_data():
    empty_resume = {"status": "ok", "text": "", "sections": {}}
    result = analyzer.evaluate_job_fit(empty_resume, MOCK_JOB_DETAIL)
    assert result["status"] == "ok"
    assert result["hard_criteria"]["experience"]["status"] == "unmentioned"
