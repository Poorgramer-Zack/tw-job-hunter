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
