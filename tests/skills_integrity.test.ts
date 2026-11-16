import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(import.meta.dirname, "..");
const SKILLS_DIR = path.join(ROOT, "skills");
const ALT_SKILLS_DIR = path.join(ROOT, ".claude", "skills");

function getSkillPath(name: string): string {
  const p = path.join(SKILLS_DIR, name, "SKILL.md");
  if (fs.existsSync(p)) {
    return p;
  }
  return path.join(ALT_SKILLS_DIR, name, "SKILL.md");
}

describe("skills integrity", () => {
  it("test_resume_advisor_skill_file_exists_and_valid", () => {
    const skillFile = getSkillPath("resume-advisor");
    expect(fs.existsSync(skillFile)).toBe(true);
    const content = fs.readFileSync(skillFile, "utf-8");
    const fm = frontmatterOf(content);

    expect(fm).toMatch(/^name: resume-advisor$/m);
    expect(fm).toMatch(/^description: .+/m);
    for (const trigger of ["履歷健診", "履歷修改", "經歷改寫", "STAR"]) {
      expect(fm).toContain(trigger);
    }

    expect(content).toContain("STAR");
    expect(content.includes("1 頁") || content.includes("一頁")).toBe(true);
    expect(content.includes("進度條") || content.includes("★★★★☆")).toBe(true);
    expect(content.includes("項目") && content.includes("專案")).toBe(true);
    expect(content.includes("去 AI") || content.includes("AI 腔調")).toBe(true);
    expect(content.includes("12 組") || content.includes("Bad")).toBe(true);

    expect(content).toContain("parse_resume_pdf");
    expect(content).toContain("job104_job_detail");
    expect(content).toContain("yourator_job_detail");
    expect(content).toContain("待補");
    expect(
      content.includes("不編造") ||
        content.includes("不杜撰") ||
        content.includes("不自行編造"),
    ).toBe(true);
    expect(content).toContain("全形標點");

    for (const badTerm of ["對標", "痛點", "成效覆盤", "$\\to$"]) {
      expect(content).not.toContain(badTerm);
    }
  });

  it("test_resume_advisor_supports_two_formats", () => {
    const content = fs.readFileSync(getSkillPath("resume-advisor"), "utf-8");

    expect(content).toContain("詳細版");
    expect(content).toContain("精簡版");
    expect(content).toContain("固定欄位");
    expect(content).toContain("先問使用者");
    expect(content).not.toContain("適用於 Cake");
    expect(content).not.toContain("來源不明");
    expect(content).not.toContain("外商精簡版");
    expect(content).not.toContain("104 詳細版");
  });

  it("test_cover_letter_skill_file_exists_and_valid", () => {
    const skillFile = getSkillPath("cover-letter");
    expect(fs.existsSync(skillFile)).toBe(true);
    const content = fs.readFileSync(skillFile, "utf-8");
    const fm = frontmatterOf(content);

    expect(fm).toMatch(/^name: cover-letter$/m);
    expect(fm).toMatch(/^description: .+/m);
    for (const trigger of ["自薦信", "求職信", "應徵信", "給公司的話", "cover letter"]) {
      expect(fm).toContain(trigger);
    }

    expect(content).toContain("150");
    expect(content).toContain("120");
    expect(content).toContain("180");
    expect(content).toMatch(/2\s*[至–-]\s*3\s*(?:個)?(?:自然)?短段/);
    expect(content).not.toContain("300");
    expect(content).not.toContain("四段");

    expect(content).toContain("parse_resume_pdf");
    expect(content).toContain("job104_job_detail");
    expect(content).toContain("yourator_job_detail");
    expect(content).toContain("待補");
    expect(content.includes("不編造") || content.includes("不杜撰")).toBe(true);

    expect(content).toContain("JD");
    expect(content).toContain("貢獻");
    expect(content.includes("關鍵詞") || content.includes("關鍵字")).toBe(true);

    expect(content.includes("嚴禁段落標題") || content.includes("中括號")).toBe(true);
    expect(content.includes("[...]") || content.includes("\\[...\\]")).toBe(true);
    expect(content.includes("禁止自曝弱點") || content.includes("自曝其短")).toBe(true);
    expect(content).toContain("深感榮幸");
    expect(content).toContain("全形標點");
    expect(content).toContain("台灣");

    for (const badTerm of ["對標", "痛點", "成效覆盤", "$\\to$"]) {
      expect(content).not.toContain(badTerm);
    }
  });

  it("test_skills_separation_and_no_cross_contamination", () => {
    const advisorContent = fs.readFileSync(getSkillPath("resume-advisor"), "utf-8");
    const letterContent = fs.readFileSync(getSkillPath("cover-letter"), "utf-8");

    expect(letterContent).toContain("自薦信");
    expect(advisorContent).toContain("履歷調整建議顧問");
    expect(letterContent).toContain("candidate@example.com");
    expect(letterContent).toContain("陳冠宇");
  });
});

function frontmatterOf(content: string): string {
  const m = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  return m ? m[1] : "";
}

describe("job-fit skill", () => {
  const file = path.join(SKILLS_DIR, "job-fit", "SKILL.md");

  it("test_job_fit_skill_file_exists_with_frontmatter", () => {
    expect(fs.existsSync(file)).toBe(true);
    const fm = frontmatterOf(fs.readFileSync(file, "utf-8"));
    expect(fm).toMatch(/^name: job-fit$/m);
    expect(fm).toMatch(/^description: .+/m);
    for (const trigger of [
      "這個職缺適合我嗎",
      "適配度",
      "履歷對 JD",
      "適不適合",
      "能不能投",
      "勝算",
      "落差",
      "JD 對照",
      "fit",
    ]) {
      expect(fm).toContain(trigger);
    }
  });

  it("test_job_fit_skill_has_five_sections_and_no_scores", () => {
    const content = fs.readFileSync(file, "utf-8");
    for (const section of ["硬性條件", "契合點", "缺口", "推測事項", "待釐清"]) {
      expect(content).toContain(section);
    }
    expect(content).toContain("未提及");
    expect(content).toContain("推測");
    expect(content).toContain("門檻");
    expect(content).toContain("不重複");
    for (const banned of ["分數", "百分比", "錄取率"]) {
      expect(content).toContain(banned);
    }
  });

  it("test_job_fit_skill_documents_resume_and_jd_sources", () => {
    const content = fs.readFileSync(file, "utf-8");
    expect(content).toContain("parse_resume_pdf");
    expect(content).toContain("job104_job_detail");
    expect(content).toContain("yourator_job_detail");
    expect(content).toContain("貼上的 JD");
  });

  it("test_job_fit_skill_is_self_contained_and_prompt_injection_safe", () => {
    const content = fs.readFileSync(file, "utf-8");
    expect(content).not.toContain("依 `resume-advisor`");
    expect(content).toContain("全形標點");
    expect(content).toContain("台灣");
    expect(content).toContain("不執行");
    expect(content.includes("僅視為") || content.includes("純粹視為")).toBe(true);
  });
});

describe("job-hunt-flow skill", () => {
  const file = path.join(SKILLS_DIR, "job-hunt-flow", "SKILL.md");

  it("test_job_hunt_flow_skill_file_exists_with_frontmatter", () => {
    expect(fs.existsSync(file)).toBe(true);
    const fm = frontmatterOf(fs.readFileSync(file, "utf-8"));
    expect(fm).toMatch(/^name: job-hunt-flow$/m);
    expect(fm).toMatch(/^description: .+/m);
    for (const trigger of ["找工作", "投遞準備", "求職流程", "查公司", "自薦信"]) {
      expect(fm).toContain(trigger);
    }
  });

  it("test_job_hunt_flow_skill_covers_seven_stages_and_handoffs", () => {
    const content = fs.readFileSync(file, "utf-8");
    for (const stage of ["搜尋", "篩選", "選定", "適配度", "公司研調", "履歷調整", "自薦信"]) {
      expect(content).toContain(stage);
    }
    for (const target of ["job-fit", "company_research", "resume-advisor", "cover-letter"]) {
      expect(content).toContain(target);
    }
    expect(content).toContain("停下來");
    expect(content).toContain("確認");
    expect(content).toContain("parse_resume_pdf");
    expect(content).toContain("沿用");
    expect(content.includes("缺少平台或關鍵字") || content.includes("已提供")).toBe(true);
    expect(content).not.toContain("先問平台與關鍵字，其餘條件再補");
  });

  it("test_job_hunt_flow_separates_104_remote_search", () => {
    const content = fs.readFileSync(file, "utf-8");
    expect(content).toContain("job104_search");
    expect(content).toContain("areas");
    expect(content).toContain("remote");
    expect(content).toContain("分開搜尋");
    expect(content).toContain("job_code");
  });
});

describe("skills boundary and privacy", () => {
  const SKILL_NAMES = ["job-fit", "job-hunt-flow", "resume-advisor", "cover-letter"];
  const fileOf = (name: string) => path.join(SKILLS_DIR, name, "SKILL.md");

  it("test_job_fit_and_flow_exclude_star_and_word_count_rules", () => {
    for (const name of ["job-fit", "job-hunt-flow"]) {
      const content = fs.readFileSync(fileOf(name), "utf-8");
      expect(content, name).not.toContain("STAR");
      expect(content, name).not.toContain("300");
    }
  });

  it("test_job_hunt_flow_excludes_fit_judgment_rules", () => {
    const content = fs.readFileSync(fileOf("job-hunt-flow"), "utf-8");
    expect(content).not.toContain("未提及");
  });

  it("test_skills_contain_no_phone_numbers_and_only_example_emails", () => {
    for (const name of SKILL_NAMES) {
      const content = fs.readFileSync(fileOf(name), "utf-8");
      expect(content, name).not.toMatch(/09\d{2}-?\d{3}-?\d{3}/);
      const emails = content.match(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g) ?? [];
      for (const email of emails) {
        expect(email.endsWith("@example.com"), `${name}: ${email}`).toBe(true);
      }
    }
  });

  it("test_all_skills_have_single_line_description_and_clean_tw_style", () => {
    for (const name of SKILL_NAMES) {
      const content = fs.readFileSync(fileOf(name), "utf-8");
      const fm = frontmatterOf(content);
      expect(fm, name).toMatch(new RegExp(`^name: ${name}$`, "m"));
      const descMatch = fm.match(/^description:\s*(.+)$/m);
      expect(descMatch, `${name} missing single-line description`).not.toBeNull();
      expect(descMatch?.[1], `${name} unquoted colon-space in description`).not.toContain(": ");
      for (const badTerm of ["對標", "痛點", "成效覆盤", "$\\to$"]) {
        expect(content, `${name} contains ${badTerm}`).not.toContain(badTerm);
      }
    }
  });
});
