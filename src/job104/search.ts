/**
 * 104 職缺搜尋：使用者選項 -> 104 query；104 JSON -> 精簡職缺清單。
 */

import { Schema104Error, getJson } from "./client.js";
import { areaCode, jobcatCode } from "./codes.js";

export const SEARCH_URL = "https://www.104.com.tw/jobs/search/api/jobs";
export const SEARCH_PAGE = "https://www.104.com.tw/jobs/search/";

export const REMOTE = { full: "1", partial: "2", any: "1,2" } as const;
export const ORDER = { relevance: 15, newest: 16, salary: 13 } as const;
export const SALARY_TYPE = { monthly: "M", yearly: "Y" } as const;
export const JOB_TYPE = { full_time: 1, part_time: 2 } as const;
export const REMOTE_TYPE: Record<number, string> = { 1: "full", 2: "partial" };
export const SUMMARY_LEN = 150;
export const NO_UPPER_LIMIT = 9999999; // 104 用此值表示薪資無上限

export interface SearchOptions {
  keyword: string;
  page?: number;
  areas?: string[] | null;
  remote?: "full" | "partial" | "any" | null;
  salary_min?: number | null;
  salary_type?: "monthly" | "yearly";
  job_categories?: string[] | null;
  job_type?: "full_time" | "part_time" | null;
  order?: "relevance" | "newest" | "salary";
}

export interface SearchJob {
  job_code: string;
  title: string | null;
  company: string | null;
  company_code: string | null;
  area: string | null;
  salary: string;
  salary_low: number | null;
  salary_high: number | null;
  remote: string;
  url: string;
  posted: string | null;
  summary: string;
}

export interface SearchResult {
  total: number | null;
  page: number | null;
  last_page: number | null;
  jobs: SearchJob[];
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function choice<T>(value: unknown, table: Record<string, T>, label: string): T {
  if (typeof value !== "string" || !Object.hasOwn(table, value)) {
    throw new Error(`${label} 只接受：${Object.keys(table).join(", ")}，收到「${String(value)}」`);
  }
  return table[value];
}

export async function buildParams(options: SearchOptions): Promise<Record<string, string | number>> {
  const {
    keyword,
    page = 1,
    areas = null,
    remote = null,
    salary_min = null,
    salary_type = "monthly",
    job_categories = null,
    job_type = null,
    order = "relevance",
  } = options;

  if (!keyword || !keyword.trim()) {
    throw new Error("keyword 不可為空");
  }
  if (page < 1) {
    throw new Error("page 必須 >= 1");
  }

  const params: Record<string, string | number> = {
    keyword: keyword.trim(),
    page,
    pagesize: 20,
    order: choice(order, ORDER, "order"),
  };

  if (areas && areas.length > 0) {
    const resolved: string[] = [];
    for (const a of areas) {
      resolved.push(await areaCode(a));
    }
    params.area = resolved.join(",");
  }

  if (remote !== null && remote !== undefined) {
    params.remoteWork = choice(remote, REMOTE, "remote");
  }

  if (salary_min !== null && salary_min !== undefined) {
    if (salary_min <= 0) {
      throw new Error("salary_min 必須是正整數");
    }
    params.scmin = salary_min;
    params.sctp = choice(salary_type, SALARY_TYPE, "salary_type");
    params.scstrict = 1;
  }

  if (job_categories && job_categories.length > 0) {
    const resolved: string[] = [];
    for (const c of job_categories) {
      resolved.push(await jobcatCode(c));
    }
    params.jobcat = resolved.join(",");
  }

  if (job_type !== null && job_type !== undefined) {
    params.ro = choice(job_type, JOB_TYPE, "job_type");
  }

  return params;
}

export function formatSalary(low: number, high: number): string {
  if (!low && !high) return "面議";
  if (!high || high >= NO_UPPER_LIMIT) return `${low}以上`;
  return `${low}~${high}`;
}

export function formatJob(j: Record<string, unknown>): SearchJob {
  const link = isRecord(j.link) ? j.link : null;
  const url = typeof link?.job === "string" ? link.job : "";
  const desc = (typeof j.description === "string" ? j.description : "").trim();
  const salaryLow = typeof j.salaryLow === "number" ? j.salaryLow : 0;
  const salaryHigh = typeof j.salaryHigh === "number" ? j.salaryHigh : 0;
  const remoteWorkType = typeof j.remoteWorkType === "number" ? j.remoteWorkType : -1;

  return {
    job_code: url.replace(/\/+$/, "").split("/").at(-1)?.split("?")[0] ?? "",
    title: (j.jobName as string | undefined) ?? null,
    company: (j.custName as string | undefined) ?? null,
    company_code: (j.custNo as string | undefined) ?? null,
    area: (j.jobAddrNoDesc as string | undefined) ?? null,
    salary: formatSalary(salaryLow, salaryHigh),
    salary_low: (j.salaryLow as number | undefined) ?? null,
    salary_high: (j.salaryHigh as number | undefined) ?? null,
    remote: REMOTE_TYPE[remoteWorkType] ?? "none",
    url,
    posted: (j.appearDate as string | undefined) ?? null,
    summary: desc.slice(0, SUMMARY_LEN) + (desc.length > SUMMARY_LEN ? "…" : ""),
  };
}

export function normalize(payload: unknown): SearchResult {
  const data = isRecord(payload) ? payload.data : null;
  const metadata = isRecord(payload) && isRecord(payload.metadata) ? payload.metadata : null;
  const pag = metadata && isRecord(metadata.pagination) ? metadata.pagination : null;

  if (!Array.isArray(data) || !pag) {
    throw new Schema104Error("搜尋回應缺少 data 或 metadata.pagination，104 回應格式可能已改變");
  }

  return {
    total: (pag.total as number | undefined) ?? null,
    page: (pag.currentPage as number | undefined) ?? null,
    last_page: (pag.lastPage as number | undefined) ?? null,
    jobs: data.map((j) => formatJob(isRecord(j) ? j : {})),
  };
}

export async function search(options: SearchOptions): Promise<SearchResult> {
  const params = await buildParams(options);
  const out = normalize(await getJson(SEARCH_URL, params, SEARCH_PAGE));
  const remote = options.remote;
  if (remote) {
    // 104 會在結果中塞入不符篩選的廣告職缺，這裡依遠端條件再過濾一次
    const allowed = remote === "any" ? new Set(["full", "partial"]) : new Set([remote]);
    out.jobs = out.jobs.filter((j) => allowed.has(j.remote));
  }
  return out;
}
