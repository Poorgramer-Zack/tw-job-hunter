/**
 * Yourator 職缺詳情：網址或路徑 -> JSON-LD 與 DOM 區塊解析，不觸碰內嵌使用者資料。
 */

import { type HTMLElement, type Node, NodeType, parse } from "node-html-parser";
import { SourceError, request } from "../company/http.js";
import { BASE, SOURCE } from "./codes.js";
import { type SalaryUnit, parseSalaryText } from "./search.js";

export const PAGE_HEADERS: Record<string, string> = {
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "zh-TW,zh;q=0.9",
  Referer: `${BASE}/jobs`,
};

export type RemoteValue = "full" | "partial" | "none" | "unknown";

export interface RemoteInfo {
  value: RemoteValue;
  text: string | null;
}

export interface YouratorJobDetailOk {
  status: "ok";
  job_code: string;
  title: string | null;
  company: string | null;
  company_legal_name: string | null;
  employment_type: string | null;
  posted: string | null;
  valid_until: string | null;
  location: string | null;
  salary: string | null;
  salary_low: number | null;
  salary_high: number | null;
  salary_unit: SalaryUnit | null;
  work_content: string | null;
  requirements: string | null;
  nice_to_have: string | null;
  benefits: string | null;
  remote_work: RemoteInfo;
  remote_interview: RemoteInfo;
  tags: string[];
  url: string;
}

export interface YouratorJobDetailNotFound {
  status: "not_found";
  url: string;
  message: string;
}

export type YouratorJobDetailResult = YouratorJobDetailOk | YouratorJobDetailNotFound;

const ALLOWED_HOSTS = new Set(["www.yourator.co", "yourator.co"]);
const JOB_PATH_RE = /^\/companies\/([^/?#]+)\/jobs\/(\d+)\/?$/;
const BLOCK_TAGS = new Set([
  "P",
  "DIV",
  "LI",
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
  "SECTION",
  "TR",
  "UL",
  "OL",
  "BLOCKQUOTE",
]);

const UNIT_TEXT_MAP: Record<string, SalaryUnit> = {
  MONTH: "monthly",
  YEAR: "yearly",
  HOUR: "hourly",
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

export function parseJobUrl(raw: string): { slug: string; jobCode: string; url: string } {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) {
    throw new Error("職缺網址不可為空");
  }

  let parsed: URL;
  if (trimmed.startsWith("/") && !trimmed.startsWith("//")) {
    parsed = new URL(trimmed, BASE);
  } else if (/^https?:\/\//i.test(trimmed)) {
    try {
      parsed = new URL(trimmed);
    } catch {
      throw new Error(`無法解析 Yourator 職缺網址：「${trimmed}」`);
    }
    if (!ALLOWED_HOSTS.has(parsed.hostname.toLowerCase())) {
      throw new Error(
        `僅支援 yourator.co 職缺網址，收到主機「${parsed.hostname}」`,
      );
    }
  } else {
    throw new Error(
      `無法從「${trimmed}」解析出 Yourator 職缺網址，請傳入 https://www.yourator.co/companies/{公司}/jobs/{編號} 或 /companies/{公司}/jobs/{編號}`,
    );
  }

  const m = JOB_PATH_RE.exec(parsed.pathname);
  if (!m) {
    throw new Error(
      `Yourator 職缺路徑格式不符：「${parsed.pathname}」，須為 /companies/{公司}/jobs/{編號}`,
    );
  }

  const [, slug, jobCode] = m;
  return {
    slug,
    jobCode,
    url: `${BASE}/companies/${slug}/jobs/${jobCode}`,
  };
}

function decodeBasicEntities(s: string): string {
  return s
    .replaceAll("&nbsp;", " ")
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&rsquo;", "'")
    .replaceAll("&lsquo;", "'")
    .replaceAll("&ldquo;", '"')
    .replaceAll("&rdquo;", '"');
}

function collectHtmlLines(node: Node, out: string[]): void {
  if (node.nodeType === NodeType.TEXT_NODE) {
    const cleaned = decodeBasicEntities(node.text).replace(/\s+/g, " ");
    if (cleaned) {
      out.push(cleaned);
    }
    return;
  }
  if (node.nodeType !== NodeType.ELEMENT_NODE) {
    return;
  }
  const el = node as HTMLElement;
  const tag = el.tagName?.toUpperCase() ?? "";
  if (tag === "BR") {
    out.push("\n");
    return;
  }
  const isBlock = BLOCK_TAGS.has(tag);
  if (isBlock) {
    out.push("\n");
  }
  for (const child of el.childNodes) {
    collectHtmlLines(child, out);
  }
  if (isBlock) {
    out.push("\n");
  }
}

export function htmlToText(source: string | Node | null | undefined): string | null {
  if (!source) return null;
  const node = typeof source === "string" ? parse(source) : source;
  const chunks: string[] = [];
  collectHtmlLines(node, chunks);
  const lines = chunks
    .join("")
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .filter((line) => line.length > 0);
  return lines.length > 0 ? lines.join("\n") : null;
}

function extractJobPostingJsonLd(root: HTMLElement): Record<string, unknown> | null {
  for (const script of root.querySelectorAll('script[type="application/ld+json"]')) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(script.text);
    } catch {
      continue;
    }
    if (!isRecord(parsed)) continue;
    if (parsed["@type"] === "JobPosting") {
      return parsed;
    }
    if (Array.isArray(parsed["@graph"])) {
      const found = parsed["@graph"].find(
        (g) => isRecord(g) && g["@type"] === "JobPosting",
      );
      if (isRecord(found)) {
        return found;
      }
    }
  }
  return null;
}

function parseValidThrough(raw: unknown): string | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  const m = /^(\d{4})/.exec(raw.trim());
  if (m && Number(m[1]) >= 2100) {
    return null;
  }
  return raw.trim();
}

function extractLocation(ld: Record<string, unknown> | null): string | null {
  if (!ld) return null;
  const jobLocation = Array.isArray(ld.jobLocation) ? ld.jobLocation[0] : ld.jobLocation;
  if (!isRecord(jobLocation) || !isRecord(jobLocation.address)) return null;
  const addr = jobLocation.address;
  const locality =
    typeof addr.addressLocality === "string"
      ? addr.addressLocality.trim()
      : typeof addr.addressRegion === "string"
        ? addr.addressRegion.trim()
        : "";
  const street = typeof addr.streetAddress === "string" ? addr.streetAddress.trim() : "";
  if (locality && street) {
    return street.startsWith(locality) ? street : `${locality}${street}`;
  }
  return locality || street || null;
}

function extractSalaryFromJsonLd(ld: Record<string, unknown> | null): {
  salary_low: number | null;
  salary_high: number | null;
  salary_unit: SalaryUnit | null;
} {
  if (!ld || !isRecord(ld.baseSalary) || !isRecord(ld.baseSalary.value)) {
    return { salary_low: null, salary_high: null, salary_unit: null };
  }
  const val = ld.baseSalary.value;
  const low = typeof val.minValue === "number" ? val.minValue : null;
  const high = typeof val.maxValue === "number" ? val.maxValue : null;
  const unitText = typeof val.unitText === "string" ? val.unitText : "";
  const unit = UNIT_TEXT_MAP[unitText] ?? null;
  return { salary_low: low, salary_high: high, salary_unit: unit };
}

function extractBenefits(h2: HTMLElement): string | null {
  const parent = h2.parentNode as HTMLElement | null;
  if (!parent) return null;
  const parts: string[] = [];
  for (const child of parent.childNodes) {
    if (child === h2) continue;
    const text = htmlToText(child);
    if (text) parts.push(text);
  }
  return parts.length > 0 ? parts.join("\n") : null;
}

function extractRemote(h2: HTMLElement | undefined): {
  remote_work: RemoteInfo;
  remote_interview: RemoteInfo;
} {
  let remoteWork: RemoteInfo = { value: "none", text: null };
  let remoteInterview: RemoteInfo = { value: "none", text: null };
  if (!h2) {
    return { remote_work: remoteWork, remote_interview: remoteInterview };
  }

  const container = (h2.nextElementSibling ?? h2.parentNode) as HTMLElement | null;
  const blocks = container?.querySelectorAll(".remote-content") ?? [];
  const texts = blocks
    .map((b) => b.text.replace(/\s+/g, " ").trim())
    .filter((t) => t.length > 0);

  if (texts.length === 0 && h2.nextElementSibling) {
    const fallbackText = h2.nextElementSibling.text.replace(/\s+/g, " ").trim();
    if (fallbackText) texts.push(fallbackText);
  }

  for (const text of texts) {
    if (text.startsWith("完全遠端工作")) {
      remoteWork = { value: "full", text };
    } else if (text.startsWith("部分遠端工作")) {
      remoteWork = { value: "partial", text };
    } else if (text.startsWith("完全遠端面試")) {
      remoteInterview = { value: "full", text };
    } else if (text.startsWith("部分遠端面試")) {
      remoteInterview = { value: "partial", text };
    } else if (text.includes("面試") && !text.includes("工作")) {
      remoteInterview = { value: "unknown", text };
    } else {
      remoteWork = { value: "unknown", text };
    }
  }

  return { remote_work: remoteWork, remote_interview: remoteInterview };
}

function extractTags(root: HTMLElement): string[] {
  const tagLinks = root.querySelectorAll(".basic-info__tag .tag, .basic-info__tag a");
  if (tagLinks.length > 0) {
    return tagLinks.map((a) => a.text.trim()).filter((t) => t.length > 0);
  }
  const tagBox = root.querySelector(".basic-info__tag");
  if (!tagBox) return [];
  return tagBox.text
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
}

export function parseDetailHtml(
  html: string,
  canonicalUrl: string,
  fallbackJobCode: string,
): YouratorJobDetailOk {
  const root = parse(html);
  const ld = extractJobPostingJsonLd(root);
  const headings = root.querySelectorAll("h2.job-heading");

  if (!ld && headings.length === 0) {
    throw new SourceError("schema", "Yourator 頁面格式可能已改變，找不到結構化資料與內容區塊");
  }

  const byHeading = new Map<string, HTMLElement>();
  for (const h of headings) {
    const name = h.text.trim();
    if (name && !byHeading.has(name)) {
      byHeading.set(name, h);
    }
  }

  const identifier = ld && isRecord(ld.identifier) ? ld.identifier : null;
  const org = ld && isRecord(ld.hiringOrganization) ? ld.hiringOrganization : null;

  const jobCode =
    identifier?.value !== undefined && identifier.value !== null
      ? String(identifier.value)
      : fallbackJobCode;
  const title =
    (ld && typeof ld.title === "string" ? ld.title : null) ??
    (root.querySelector(".basic-info__title h1")?.text.trim() || null);
  const company =
    (org && typeof org.name === "string" ? org.name : null) ??
    (root.querySelector(".basic-info__title--subtitle h4")?.text.trim() || null);
  const companyLegalName =
    identifier && typeof identifier.name === "string" ? identifier.name : null;

  const salaryNode = byHeading.get("薪資範圍")?.nextElementSibling;
  const salaryText = salaryNode ? salaryNode.text.replace(/\s+/g, " ").trim() || null : null;

  const ldSalary = extractSalaryFromJsonLd(ld);
  const fallbackSalary =
    salaryText && ldSalary.salary_low === null
      ? parseSalaryText(salaryText)
      : { salary_low: null, salary_high: null, salary_unit: null };

  const hasDomBlocks = headings.length > 0;
  let workContent: string | null;
  let requirements: string | null;
  let niceToHave: string | null;
  let benefits: string | null;

  if (hasDomBlocks) {
    workContent = htmlToText(byHeading.get("工作內容")?.nextElementSibling);
    requirements = htmlToText(byHeading.get("條件要求")?.nextElementSibling);
    niceToHave = htmlToText(byHeading.get("加分條件")?.nextElementSibling);
    const benefitsH2 = byHeading.get("員工福利");
    benefits = benefitsH2 ? extractBenefits(benefitsH2) : null;
  } else {
    // 降級：無任何 DOM 區塊但有 JSON-LD 時，將描述轉為純文字放到 work_content
    workContent = ld && typeof ld.description === "string" ? htmlToText(ld.description) : null;
    requirements = null;
    niceToHave = null;
    benefits = null;
  }

  const remote = extractRemote(byHeading.get("遠端型態"));

  return {
    status: "ok",
    job_code: jobCode,
    title,
    company,
    company_legal_name: companyLegalName,
    employment_type: ld && typeof ld.employmentType === "string" ? ld.employmentType : null,
    posted: ld && typeof ld.datePosted === "string" ? ld.datePosted : null,
    valid_until: ld ? parseValidThrough(ld.validThrough) : null,
    location: extractLocation(ld),
    salary: salaryText,
    salary_low: ldSalary.salary_low ?? fallbackSalary.salary_low,
    salary_high: ldSalary.salary_high ?? fallbackSalary.salary_high,
    salary_unit: ldSalary.salary_unit ?? fallbackSalary.salary_unit,
    work_content: workContent,
    requirements,
    nice_to_have: niceToHave,
    benefits,
    remote_work: remote.remote_work,
    remote_interview: remote.remote_interview,
    tags: extractTags(root),
    url: canonicalUrl,
  };
}

export async function youratorJobDetail(job: string): Promise<YouratorJobDetailResult> {
  const parsed = parseJobUrl(job);
  let html: string;
  try {
    html = await request<string>(SOURCE, "GET", parsed.url, {
      headers: PAGE_HEADERS,
      expect: "text",
    });
  } catch (err) {
    if (err instanceof SourceError && err.type === "http" && err.status === 404) {
      return {
        status: "not_found",
        url: parsed.url,
        message: "職缺不存在或已關閉",
      };
    }
    throw err;
  }
  return parseDetailHtml(html, parsed.url, parsed.jobCode);
}
