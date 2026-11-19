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

  it("test_resume_advisor_incorporates_summary_ats_bar_and_skill_balance", () => {
    const content = fs.readFileSync(getSkillPath("resume-advisor"), "utf-8");

    // 1. 個人簡歷（Summary）五面向與不編造動機
    expect(content).toContain("個人簡歷");
    for (const aspect of ["人格特質", "職涯規劃", "能力技術", "產業觀點", "求職動機"]) {
      expect(content).toContain(aspect);
    }

    // 2. 技能與職能名稱對齊 JD 原文用語與行話（ATS 篩選）
    expect(content).toContain("ATS");
    expect(content).toContain("行話");
    expect(content.includes("原文用語") || content.includes("JD 原文")).toBe(true);

    // 3. 背景限制條件前置與防浮誇數據原則
    expect(content).toContain("限制條件");
    expect(content).toContain("基數");

    // 4. 硬實力為主、軟實力以專案帶出
    expect(content).toContain("硬實力");
    expect(content).toContain("軟實力");

    // 7. STAR 為主架構整合 BAR 精簡寫法
    expect(content).toContain("STAR");
    expect(content).toContain("BAR");
    expect(content).toContain("Background");
    expect(content).toContain("Action");
    expect(content).toContain("Result");

    // 引用自傳 Skill 並移除隱私約束
    expect(content).toContain("autobiography");
    expect(content).not.toContain("隱私防護");
    expect(content).not.toContain("就業服務法");
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

  it("test_cover_letter_incorporates_yourator_motivation_anti_patterns_and_valid_example", () => {
    const content = fs.readFileSync(getSkillPath("cover-letter"), "utf-8");

    // 具體應徵動機、得知管道與不編造公司互動細節
    expect(content).toContain("應徵動機");
    expect(content).toContain("得知管道");
    expect(content).toContain("company_research");
    expect(content.includes("願景") || content.includes("理念")).toBe(true);
    expect(content.includes("產品") && content.includes("服務")).toBe(true);

    // Yourator 三大地雷：無關工作瑣事、空洞動機、敷衍／自曝弱點
    expect(content).toContain("家庭背景");
    expect(content).toContain("日常興趣");
    expect(content).toContain("很有興趣");

    // 結尾禮儀：附檔／作品集、聯絡資訊、感謝撥冗閱讀與空間
    expect(content).toContain("作品集");
    expect(content).toContain("附檔");
    expect(content).toContain("撥冗閱讀");

    // 禁止條列編號與生硬模板套話
    expect(content).toContain("1/");
    expect(content).toContain("綜合以上");
    expect(content).toContain("Sincerely");

    // 驗證內附範例本身符合 120–180 字、無標籤與無編號要求
    const exampleSection = content.split(/^## 五、標準自薦信範例.*$/m)[1] ?? "";
    const paragraphs = exampleSection
      .trim()
      .split(/\r?\n\r?\n/)
      .filter((p) => p.trim().length > 0);
    // 最後一段為署名與聯絡資訊
    expect(paragraphs.length).toBeGreaterThanOrEqual(3);
    expect(paragraphs.length).toBeLessThanOrEqual(4);
    const coreParagraphs = paragraphs.slice(0, -1);
    expect(coreParagraphs.length).toBeGreaterThanOrEqual(2);
    expect(coreParagraphs.length).toBeLessThanOrEqual(3);
    const coreText = coreParagraphs.join("");
    expect(coreText.length).toBeGreaterThanOrEqual(120);
    expect(coreText.length).toBeLessThanOrEqual(180);
    expect(coreText).not.toMatch(/[\[【]/);
    expect(coreText).not.toMatch(/(?:^|\n)\s*(?:1\.|1\/|[-*])/);
  });

  it("test_skills_separation_and_no_cross_contamination", () => {
    const advisorContent = fs.readFileSync(getSkillPath("resume-advisor"), "utf-8");
    const letterContent = fs.readFileSync(getSkillPath("cover-letter"), "utf-8");

    expect(letterContent).toContain("自薦信");
    expect(letterContent).toContain("autobiography");
    expect(advisorContent).toContain("履歷調整建議顧問");
    expect(advisorContent).toContain("autobiography");
    expect(letterContent).toContain("candidate@example.com");
    expect(letterContent).toContain("陳冠宇");
  });
});

describe("autobiography skill", () => {
  const file = path.join(SKILLS_DIR, "autobiography", "SKILL.md");

  it("test_autobiography_skill_file_exists_and_valid", () => {
    expect(fs.existsSync(file)).toBe(true);
    const content = fs.readFileSync(file, "utf-8");
    const fm = frontmatterOf(content);

    expect(fm).toMatch(/^name: autobiography$/m);
    expect(fm).toMatch(/^description: .+/m);
    for (const trigger of ["自傳", "求職自傳", "個人故事", "autobiography"]) {
      expect(fm).toContain(trigger);
    }

    // 故事本質、背景與性格判讀、互動引導漸進校正流程
    expect(content).toContain("故事");
    expect(content).toContain("背景");
    expect(content).toContain("性格");
    expect(content).toContain("初稿");
    expect(content).toContain("提問");
    expect(content).toContain("引導");
    expect(content).toContain("校正");
    expect(content).toContain("定稿");
    expect(content.includes("復述") || content.includes("重抄")).toBe(true);

    // 雙篇幅規範與 Yourator #239 重點
    expect(content).toContain("短篇");
    expect(content).toContain("長篇");
    expect(content).toContain("300");
    expect(content).toContain("800");
    expect(content).toContain("小標題");
    expect(content).toContain("ATS");

    // 素材取得、防注入、不編造、邊界與台灣在地規範
    expect(content).toContain("parse_resume_pdf");
    expect(content).toContain("job104_job_detail");
    expect(content).toContain("yourator_job_detail");
    expect(content).toContain("不執行");
    expect(content.includes("僅視為") || content.includes("純粹視為")).toBe(true);
    expect(content.includes("不編造") || content.includes("不杜撰")).toBe(true);
    expect(content).toContain("resume-advisor");
    expect(content).toContain("cover-letter");
    expect(content).toContain("全形標點");
    expect(content).toContain("台灣");
    expect(content.includes("去 AI") || content.includes("AI 腔調")).toBe(true);
  });

  it("test_autobiography_examples_respect_short_300_and_long_800_limits", () => {
    const content = fs.readFileSync(file, "utf-8");
    const shortSection = content.split(/^### 短篇範例.*$/m)[1]?.split(/^### 長篇範例.*$/m)[0] ?? "";
    const longSection = content.split(/^### 長篇範例.*$/m)[1] ?? "";

    const shortText = shortSection.trim().replace(/\s+/g, "");
    const longText = longSection.trim().replace(/\s+/g, "");

    expect(shortText.length).toBeGreaterThanOrEqual(120);
    expect(shortText.length).toBeLessThanOrEqual(300);
    expect(longText.length).toBeGreaterThan(300);
    expect(longText.length).toBeLessThanOrEqual(800);
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

  it("test_job_hunt_flow_skill_covers_eight_stages_and_handoffs", () => {
    const content = fs.readFileSync(file, "utf-8");
    for (const stage of [
      "搜尋",
      "篩選",
      "選定",
      "適配度",
      "公司研調",
      "履歷調整",
      "自傳",
      "自薦信",
    ]) {
      expect(content).toContain(stage);
    }
    for (const target of [
      "job-fit",
      "company_research",
      "resume-advisor",
      "autobiography",
      "cover-letter",
    ]) {
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
  const SKILL_NAMES = [
    "job-fit",
    "job-hunt-flow",
    "resume-advisor",
    "cover-letter",
    "autobiography",
  ];
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
