from pathlib import Path
import pytest

SKILLS_DIR = Path("skills")
ALT_SKILLS_DIR = Path(".claude/skills")


def get_skill_path(name: str) -> Path:
    p = SKILLS_DIR / name / "SKILL.md"
    if p.exists():
        return p
    return ALT_SKILLS_DIR / name / "SKILL.md"


def test_resume_advisor_skill_file_exists_and_valid():
    skill_file = get_skill_path("resume-advisor")
    assert skill_file.exists(), "resume-advisor SKILL.md must exist in skills/ or .claude/skills/"
    content = skill_file.read_text(encoding="utf-8")

    # 驗證關鍵字與核心原則
    assert "STAR" in content
    assert "1 頁" in content or "一頁" in content
    assert "進度條" in content or "★★★★☆" in content
    assert "項目" in content and "專案" in content
    assert "去 AI" in content or "AI 腔調" in content
    assert "12 組" in content or "Bad" in content


def test_cover_letter_skill_file_exists_and_valid():
    skill_file = get_skill_path("cover-letter")
    assert skill_file.exists(), "cover-letter SKILL.md must exist in skills/ or .claude/skills/"
    content = skill_file.read_text(encoding="utf-8")

    # 驗證 300 字限制與禁止標籤原則
    assert "300" in content
    assert "嚴禁段落標題" in content or "中括號" in content
    assert "[...]" in content or "\\[...\\]" in content
    assert "禁止自曝弱點" in content or "自曝其短" in content
    assert "深感榮幸" in content
    assert "四段" in content


def test_skills_separation_and_no_cross_contamination():
    advisor_content = get_skill_path("resume-advisor").read_text(encoding="utf-8")
    letter_content = get_skill_path("cover-letter").read_text(encoding="utf-8")

    # cover-letter 專屬標籤禁止不應被污染至履歷改寫
    assert "自薦信" in letter_content
    assert "履歷調整建議顧問" in advisor_content
    # 範例一律使用假名與虛構示範，不包含特定真實個人身份資訊
    assert "candidate@example.com" in letter_content
    assert "陳冠宇" in letter_content
