import { describe, expect, it } from "vitest";
import { evaluateJobFit } from "../../src/resume/analyzer.js";

const MOCK_JOB_DETAIL = {
  status: "open",
  job_code: "test_job_1",
  title: "資深 Python 後端工程師",
  company: "示範科技股份有限公司",
  requirements: {
    education: "大學以上",
    experience: "3年以上",
    tools: ["Python", "FastAPI", "PostgreSQL", "CI/CD", "Docker"],
    skills: ["系統架構規劃", "軟體工程系統開發"],
    other: "具備高併發系統架構與效能優化經驗者佳",
  },
  description:
    "我們正在尋找負責核心訂單服務架構規劃與資料庫效能優化的後端夥伴。",
};

const MOCK_RESUME_DATA = {
  status: "ok",
  text: "工作經歷：後端工程師，擁有 4 年工作經驗。畢業於國立示範大學資訊系學士。\n精通 Python、FastAPI、PostgreSQL 與 CI/CD 流程自動化。\n主導核心訂單系統架構重構與查詢效能優化。",
  sections: {
    experience: "後端工程師 4 年經驗，主導核心訂單系統架構重構",
    skills: "Python, FastAPI, PostgreSQL, CI/CD",
    education: "國立示範大學 資訊工程學系 學士",
  },
};

describe("fit analyzer", () => {
  it("硬性條件核對：學歷與年資", () => {
    const result = evaluateJobFit(MOCK_RESUME_DATA, MOCK_JOB_DETAIL);
    expect(result.status).toBe("ok");
    const hard = result.hard_criteria;

    expect(hard.education.status).toBe("met");
    expect(hard.education.candidate).toContain("大學");
    expect(hard.experience.status).toBe("met");
  });

  it("技能標籤比對與缺漏清單", () => {
    const result = evaluateJobFit(MOCK_RESUME_DATA, MOCK_JOB_DETAIL);
    const skills = result.skills_analysis;

    const matched = skills.matched_skills.map((s) => s.toLowerCase());
    expect(matched).toContain("python");
    expect(matched).toContain("fastapi");
    expect(matched).toContain("postgresql");

    const unmentioned = skills.unmentioned_skills.map((s) => s.toLowerCase());
    expect(unmentioned).toContain("docker");
  });

  it("優勢亮點提取", () => {
    const result = evaluateJobFit(MOCK_RESUME_DATA, MOCK_JOB_DETAIL);
    expect(result.advantages.length).toBeGreaterThan(0);
    expect(
      result.advantages.some(
        (a) => a.includes("架構") || a.includes("優化") || a.includes("效能"),
      ),
    ).toBe(true);
  });

  it("絕不輸出偽造分數或錄取率欄位", () => {
    const result = evaluateJobFit(MOCK_RESUME_DATA, MOCK_JOB_DETAIL);
    const bannedKeys = [
      "score",
      "match_rate",
      "percentage",
      "probability",
      "success_rate",
      "錄取率",
    ];
    for (const key of bannedKeys) {
      expect(result).not.toHaveProperty(key);
      expect(result.hard_criteria).not.toHaveProperty(key);
    }
  });

  it("履歷資料空白時不會崩潰且年資為 unmentioned", () => {
    const emptyResume = { status: "ok", text: "", sections: {} };
    const result = evaluateJobFit(emptyResume, MOCK_JOB_DETAIL);
    expect(result.status).toBe("ok");
    expect(result.hard_criteria.experience.status).toBe("unmentioned");
  });
});
