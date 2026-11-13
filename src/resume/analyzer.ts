/** 適配度診斷引擎：核對求職者履歷與目標職缺 JD 的各面向條件。 */

export const EDU_RANK: Record<string, number> = {
  "高中": 1,
  "專科": 2,
  "大學": 3,
  "碩士": 4,
  "博士": 5,
};

const YEARS_RE = /(\d+)\s*(?:年|y)/i;

export type CriterionStatus = "met" | "unmet" | "unmentioned";

export interface ResumeDataInput {
  status?: string;
  text?: string;
  sections?: Record<string, string>;
}

export interface JobDetailInput {
  job_code?: string | null;
  title?: string | null;
  company?: string | null;
  description?: string;
  requirements?: {
    education?: string | null;
    experience?: string | null;
    tools?: string[] | null;
    skills?: string[] | null;
    other?: string | null;
  };
}

export interface JobFitResult {
  status: "ok";
  job_code: string | null;
  job_title: string | null;
  company: string | null;
  hard_criteria: {
    education: {
      required: string;
      candidate: string;
      status: CriterionStatus;
    };
    experience: {
      required: string;
      candidate: string;
      status: CriterionStatus;
    };
  };
  skills_analysis: {
    matched_skills: string[];
    unmentioned_skills: string[];
  };
  advantages: string[];
  notes: string;
}

function extractYears(text: string): number | null {
  if (!text) return null;
  const m = YEARS_RE.exec(text);
  return m ? Number.parseInt(m[1], 10) : null;
}

function detectEduLevel(text: string): string | null {
  if (!text) return null;
  for (const edu of ["博士", "碩士", "大學", "專科", "高中"]) {
    if (text.includes(edu)) {
      return edu;
    }
  }
  return null;
}

/** 比對履歷文字與 104 職缺詳情，產出結構化核對結果。 */
export function evaluateJobFit(
  resumeData: ResumeDataInput,
  jobDetail: JobDetailInput,
): JobFitResult {
  const resumeText = resumeData.text ?? "";
  const reqs = jobDetail.requirements ?? {};

  // 1. 硬性條件核對：學歷
  const jobEduReq = reqs.education || "";
  const candEdu = detectEduLevel(resumeText);
  const reqEdu = detectEduLevel(jobEduReq);

  let eduStatus: CriterionStatus = "unmentioned";
  if (candEdu && reqEdu) {
    const candRank = EDU_RANK[candEdu] ?? 0;
    const reqRank = EDU_RANK[reqEdu] ?? 0;
    eduStatus = candRank >= reqRank ? "met" : "unmet";
  } else if (candEdu) {
    eduStatus = "met";
  }

  // 2. 硬性條件核對：工作年資
  const jobExpReq = reqs.experience || "";
  const reqYears = extractYears(jobExpReq);
  const candYears = extractYears(resumeText);

  let expStatus: CriterionStatus = "unmentioned";
  if (reqYears !== null && candYears !== null) {
    expStatus = candYears >= reqYears ? "met" : "unmet";
  } else if (reqYears === null) {
    expStatus = "met";
  }

  // 3. 技能標籤比對
  const toolsReq = reqs.tools ?? [];
  const skillsReq = reqs.skills ?? [];
  const allReqSkills = Array.from(new Set([...toolsReq, ...skillsReq]));

  const matchedSkills: string[] = [];
  const unmentionedSkills: string[] = [];

  const resumeTextLower = resumeText.toLowerCase();
  for (const skill of allReqSkills) {
    const skillClean = skill.trim();
    if (!skillClean) continue;
    if (resumeTextLower.includes(skillClean.toLowerCase())) {
      matchedSkills.push(skillClean);
    } else {
      unmentionedSkills.push(skillClean);
    }
  }

  // 4. 優勢亮點提取
  const jdDesc = jobDetail.description ?? "";
  const jdDescLower = jdDesc.toLowerCase();
  const highValueKeywords = [
    "架構",
    "重構",
    "高併發",
    "ci/cd",
    "效能",
    "優化",
    "微服務",
    "跨平台",
    "api",
    "ai",
  ];
  const advantageSet = new Set<string>();
  for (const kw of highValueKeywords) {
    if (jdDescLower.includes(kw) && resumeTextLower.includes(kw)) {
      advantageSet.add(`具備職缺所重視之「${kw}」相關實務背景與落地成果`);
    }
  }
  const advantages = Array.from(advantageSet);
  if (advantages.length === 0 && matchedSkills.length > 0) {
    advantages.push(`核心技能覆蓋良好：${matchedSkills.slice(0, 5).join(", ")}`);
  }

  return {
    status: "ok",
    job_code: jobDetail.job_code ?? null,
    job_title: jobDetail.title ?? null,
    company: jobDetail.company ?? null,
    hard_criteria: {
      education: {
        required: jobEduReq || "不拘",
        candidate: candEdu || "未提及",
        status: eduStatus,
      },
      experience: {
        required: jobExpReq || "不拘",
        candidate: candYears ? `${candYears} 年` : "未提及",
        status: expStatus,
      },
    },
    skills_analysis: {
      matched_skills: matchedSkills,
      unmentioned_skills: unmentionedSkills,
    },
    advantages,
    notes: "本分析為客觀條件與關鍵字核對事實，請結合求職者具體作品集與專案細節作整體判斷。",
  };
}
