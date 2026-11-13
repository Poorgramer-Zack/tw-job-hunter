/**
 * 104 職缺詳情：網址或代碼 -> 完整職缺內容。
 */

import { NotFound104Error, Schema104Error, getJson } from "./client.js";
import { REMOTE_TYPE } from "./search.js";

export const DETAIL_URL = "https://www.104.com.tw/job/ajax/content/{code}";
export const JOB_PAGE = "https://www.104.com.tw/job/{code}";

const CODE_RE = /^[0-9a-z]{4,10}$/;
const URL_RE = /104\.com\.tw\/job\/([0-9a-z]+)/;

export interface JobDetailOpen {
  job_code: string;
  status: "open";
  title: string | null;
  company: string | null;
  company_code: string | null;
  company_url: string | null;
  industry: string | null;
  posted: string | null;
  description: string | null;
  categories: Array<string | null>;
  salary: string | null;
  salary_min: number | null;
  salary_max: number | null;
  salary_type_code: number | null;
  job_type_code: number | null;
  work_type: unknown;
  address: string | null;
  work_period: string | null;
  vacation_policy: string | null;
  remote: string;
  openings: string | null;
  requirements: {
    experience: string | null;
    education: string | null;
    majors: unknown;
    languages: unknown;
    tools: Array<string | null>;
    skills: Array<string | null>;
    certificates: unknown;
    other: string | null;
  };
  welfare: {
    tags: unknown;
    text: string | null;
  };
  url: string;
}

export interface JobDetailNotFound {
  job_code: string;
  status: "not_found";
  message: string;
}

export type JobDetailResult = JobDetailOpen | JobDetailNotFound;

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

export function parseJobCode(text: string): string {
  const trimmed = (text ?? "").trim();
  const m = URL_RE.exec(trimmed);
  const code = m ? m[1] : trimmed;
  if (!CODE_RE.test(code)) {
    throw new Error(`無法從「${trimmed}」解析出 104 職缺代碼，請傳入職缺網址或代碼（例如 8u9za）`);
  }
  return code;
}

function descs(items: unknown): Array<string | null> {
  if (!Array.isArray(items)) return [];
  return items
    .filter((i): i is Record<string, unknown> => isRecord(i))
    .map((i) => (i.description as string | undefined) ?? null);
}

export function normalize(payload: unknown, code: string): JobDetailOpen {
  const d = isRecord(payload) && isRecord(payload.data) ? payload.data : null;
  const jd = d && isRecord(d.jobDetail) ? d.jobDetail : null;
  if (!d || !jd) {
    throw new Schema104Error("詳情回應缺少 data.jobDetail，104 回應格式可能已改變");
  }

  const h = isRecord(d.header) ? d.header : {};
  const c = isRecord(d.condition) ? d.condition : {};
  const w = isRecord(d.welfare) ? d.welfare : {};
  const remoteWork = isRecord(jd.remoteWork) ? jd.remoteWork : {};
  const remoteType = typeof remoteWork.type === "number" ? remoteWork.type : -1;

  return {
    job_code: code,
    status: "open",
    title: (h.jobName as string | undefined) ?? null,
    company: (h.custName as string | undefined) ?? null,
    company_code: (d.custNo as string | undefined) ?? null,
    company_url: (h.custUrl as string | undefined) ?? null,
    industry: (d.industry as string | undefined) ?? null,
    posted: (h.appearDate as string | undefined) ?? null,
    description: (jd.jobDescription as string | undefined) ?? null,
    categories: descs(jd.jobCategory),
    salary: (jd.salary as string | undefined) ?? null,
    salary_min: (jd.salaryMin as number | undefined) ?? null,
    salary_max: (jd.salaryMax as number | undefined) ?? null,
    salary_type_code: (jd.salaryType as number | undefined) ?? null,
    job_type_code: (jd.jobType as number | undefined) ?? null,
    work_type: jd.workType ?? null,
    address: `${(jd.addressRegion as string | undefined) ?? ""}${(jd.addressDetail as string | undefined) ?? ""}` || null,
    work_period: (jd.workPeriod as string | undefined) ?? null,
    vacation_policy: (jd.vacationPolicy as string | undefined) ?? null,
    remote: REMOTE_TYPE[remoteType] ?? "none",
    openings: (jd.needEmp as string | undefined) ?? null,
    requirements: {
      experience: (c.workExp as string | undefined) ?? null,
      education: (c.edu as string | undefined) ?? null,
      majors: c.major ?? null,
      languages: c.language ?? null,
      tools: descs(c.specialty),
      skills: descs(c.skill),
      certificates: c.certificate ?? null,
      other: (c.other as string | undefined) ?? null,
    },
    welfare: {
      tags: w.tag ?? null,
      text: (w.welfare as string | undefined) ?? null,
    },
    url: JOB_PAGE.replace("{code}", code),
  };
}

export async function detail(job: string): Promise<JobDetailResult> {
  const code = parseJobCode(job);
  const url = DETAIL_URL.replace("{code}", code);
  const referer = JOB_PAGE.replace("{code}", code);
  try {
    const payload = await getJson(url, undefined, referer);
    return normalize(payload, code);
  } catch (err) {
    if (err instanceof NotFound104Error) {
      return { job_code: code, status: "not_found", message: "職缺不存在或已關閉" };
    }
    throw err;
  }
}
