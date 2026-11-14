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

    expect(content).toContain("STAR");
    expect(content.includes("1 頁") || content.includes("一頁")).toBe(true);
    expect(content.includes("進度條") || content.includes("★★★★☆")).toBe(true);
    expect(content.includes("項目") && content.includes("專案")).toBe(true);
    expect(content.includes("去 AI") || content.includes("AI 腔調")).toBe(true);
    expect(content.includes("12 組") || content.includes("Bad")).toBe(true);
  });

  it("test_cover_letter_skill_file_exists_and_valid", () => {
    const skillFile = getSkillPath("cover-letter");
    expect(fs.existsSync(skillFile)).toBe(true);
    const content = fs.readFileSync(skillFile, "utf-8");

    expect(content).toContain("300");
    expect(content.includes("嚴禁段落標題") || content.includes("中括號")).toBe(true);
    expect(content.includes("[...]") || content.includes("\\[...\\]")).toBe(true);
    expect(content.includes("禁止自曝弱點") || content.includes("自曝其短")).toBe(true);
    expect(content).toContain("深感榮幸");
    expect(content).toContain("四段");
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
    expect(fm).toContain("這個職缺適合我嗎");
    expect(fm).toContain("適配度");
    expect(fm).toContain("履歷對 JD");
  });

  it("test_job_fit_skill_has_five_sections_and_no_scores", () => {
    const content = fs.readFileSync(file, "utf-8");
    for (const section of ["硬性條件", "契合點", "缺口", "推測事項", "待釐清"]) {
      expect(content).toContain(section);
    }
    expect(content).toContain("未提及");
    expect(content).toContain("推測");
    for (const banned of ["分數", "百分比", "錄取率"]) {
      expect(content).toContain(banned);
    }
  });

  it("test_job_fit_skill_documents_resume_and_jd_sources", () => {
    const content = fs.readFileSync(file, "utf-8");
    expect(content).toContain("parse_resume_pdf");
    expect(content).toContain("貼上的 JD");
  });
});

describe("job-hunt-flow skill", () => {
  const file = path.join(SKILLS_DIR, "job-hunt-flow", "SKILL.md");

  it("test_job_hunt_flow_skill_file_exists_with_frontmatter", () => {
    expect(fs.existsSync(file)).toBe(true);
    const fm = frontmatterOf(fs.readFileSync(file, "utf-8"));
    expect(fm).toMatch(/^name: job-hunt-flow$/m);
    expect(fm).toMatch(/^description: .+/m);
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
});
