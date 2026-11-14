/**
 * Yourator 職缺搜尋：使用者選項 -> Yourator query；Yourator JSON -> 精簡職缺清單。
 */

import { SourceError, request } from "../company/http.js";
import { BASE, SOURCE, XHR_HEADERS, areaCode, categoryCode } from "./codes.js";

export const SEARCH_URL = `${BASE}/api/v4/jobs`;
export const SALARY_UPPER_BOUND = 10_000_000;

export const REMOTE = {
  full: ["full"],
  partial: ["partial"],
  any: ["full", "partial"],
} as const;

export const ORDER = {
  relevance: "most_related",
  newest: "recent_updated",
} as const;

export const SALARY_TYPE = {
  monthly: "monthly",
  yearly: "yearly",
} as const;

export const JOB_TYPE = {
  full_time: "full_time",
  part_time: "part_time",
  contract: "contract",
  temporary: "temporary",
  intern: "intern",
} as const;

export type SalaryUnit = "monthly" | "yearly" | "hourly";

export interface YouratorSearchOptions {
  keyword: string;
  page?: number;
  areas?: string[] | null;
  job_categories?: string[] | null;
  remote?: "full" | "partial" | "any" | null;
  salary_min?: number | null;
  salary_type?: "monthly" | "yearly";
  job_type?: "full_time" | "part_time" | "contract" | "temporary" | "intern" | null;
  order?: "relevance" | "newest";
}

export interface YouratorSearchJob {
  job_code: string;
  title: string | null;
  company: string | null;
  company_path: string | null;
  area: string | null;
  salary: string;
  salary_low: number | null;
  salary_high: number | null;
  salary_unit: SalaryUnit | null;
  url: string;
  updated_text: string | null;
  tags: string[];
}

export interface YouratorSearchResult {
  page: number;
  has_more: boolean;
  jobs: YouratorSearchJob[];
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

export async function buildQueryPairs(
  options: YouratorSearchOptions,
): Promise<Array<[string, string]>> {
  const {
    keyword,
    page = 1,
    areas = null,
    job_categories = null,
    remote = null,
    salary_min = null,
    salary_type = "monthly",
    job_type = null,
    order = "relevance",
  } = options;

  if (!keyword || !keyword.trim()) {
    throw new Error("keyword 不可為空");
  }
  if (!Number.isInteger(page) || page < 1) {
    throw new Error("page 必須是 >= 1 的整數");
  }
  const sortValue = choice(order, ORDER, "order");
  const remoteValues = remote !== null && remote !== undefined ? choice(remote, REMOTE, "remote") : null;
  const positionValue =
    job_type !== null && job_type !== undefined ? choice(job_type, JOB_TYPE, "job_type") : null;
  const salaryUnitType = choice(salary_type, SALARY_TYPE, "salary_type");

  let monthlyMin: number | null = null;
  if (salary_min !== null && salary_min !== undefined) {
    if (!Number.isInteger(salary_min) || salary_min <= 0) {
      throw new Error("salary_min 必須是正整數");
    }
    monthlyMin = salaryUnitType === "yearly" ? Math.ceil(salary_min / 12) : salary_min;
  }

  const pairs: Array<[string, string]> = [["term[]", keyword.trim()]];

  if (areas && areas.length > 0) {
    for (const a of areas) {
      pairs.push(["area[]", await areaCode(a)]);
    }
  }

  if (job_categories && job_categories.length > 0) {
    for (const c of job_categories) {
      pairs.push(["category[]", await categoryCode(c)]);
    }
  }

  if (remoteValues) {
    for (const r of remoteValues) {
      pairs.push(["remote_work[]", r]);
    }
  }

  if (monthlyMin !== null) {
    pairs.push(["monthly", `${monthlyMin},${SALARY_UPPER_BOUND}`]);
  }

  if (positionValue) {
    pairs.push(["position[]", positionValue]);
  }

  pairs.push(["sort", sortValue]);
  pairs.push(["page", String(page)]);
  return pairs;
}

export function parseSalaryText(raw: string): {
  salary_low: number | null;
  salary_high: number | null;
  salary_unit: SalaryUnit | null;
} {
  if (!raw || /面議/.test(raw)) {
    return { salary_low: null, salary_high: null, salary_unit: null };
  }
  const nums = (raw.match(/\d[\d,]*/g) ?? []).map((x) => Number(x.replace(/,/g, "")));
  if (nums.length === 0) {
    return { salary_low: null, salary_high: null, salary_unit: null };
  }
  const salary_unit: SalaryUnit | null = /年薪/.test(raw)
    ? "yearly"
    : /月薪/.test(raw)
      ? "monthly"
      : /時薪/.test(raw)
        ? "hourly"
        : null;

  if (nums.length >= 2) {
    return { salary_low: nums[0], salary_high: nums[1], salary_unit };
  }
  const openUpper = /以上|-\s*\(/.test(raw) || raw.trim().endsWith("-");
  return {
    salary_low: nums[0],
    salary_high: openUpper ? null : nums[0],
    salary_unit,
  };
}

export function formatJob(j: Record<string, unknown>): YouratorSearchJob {
  const company = isRecord(j.company) ? j.company : null;
  const rawPath = typeof j.path === "string" ? j.path : "";
  const url = rawPath ? (rawPath.startsWith("http") ? rawPath : `${BASE}${rawPath}`) : "";
  const id = j.id !== undefined && j.id !== null ? String(j.id) : "";
  const salary = typeof j.salary === "string" ? j.salary : "";
  const parsedSalary = parseSalaryText(salary);
  const tags = Array.isArray(j.tags)
    ? j.tags.filter((t): t is string => typeof t === "string")
    : [];

  return {
    job_code: id,
    title: typeof j.name === "string" ? j.name : null,
    company: typeof company?.brand === "string" ? company.brand : null,
    company_path: typeof company?.path === "string" ? company.path : null,
    area: typeof j.location === "string" ? j.location : null,
    salary,
    salary_low: parsedSalary.salary_low,
    salary_high: parsedSalary.salary_high,
    salary_unit: parsedSalary.salary_unit,
    url,
    updated_text: typeof j.lastActiveAt === "string" ? j.lastActiveAt : null,
    tags,
  };
}

export function normalize(payload: unknown, requestedPage = 1): YouratorSearchResult {
  const inner = isRecord(payload) && isRecord(payload.payload) ? payload.payload : null;
  if (!inner || !Array.isArray(inner.jobs)) {
    throw new SourceError("schema", "Yourator 搜尋回應缺少 payload.jobs，格式可能已改變");
  }

  return {
    page: typeof inner.currentPage === "number" ? inner.currentPage : requestedPage,
    has_more: Boolean(inner.hasMore),
    jobs: inner.jobs.map((j) => formatJob(isRecord(j) ? j : {})),
  };
}

export async function youratorSearch(
  options: YouratorSearchOptions,
): Promise<YouratorSearchResult> {
  const pairs = await buildQueryPairs(options);
  const query = new URLSearchParams(pairs).toString();
  const data = await request<unknown>(SOURCE, "GET", `${SEARCH_URL}?${query}`, {
    headers: XHR_HEADERS,
  });
  const result = normalize(data, options.page ?? 1);
  if (options.salary_min !== null && options.salary_min !== undefined) {
    result.jobs = result.jobs.filter((j) => !j.salary.includes("面議"));
  }
  return result;
}
