import * as goodjob from "./goodjob.js";
import { SourceError } from "./http.js";
import * as interviewTw from "./interview_tw.js";
import * as links from "./links.js";
import * as qollie from "./qollie.js";
import * as registry from "./registry.js";
import * as web from "./web.js";

export const MAX_REVIEW_LIMIT = 50;
export const SKIPPED = {
  status: "skipped",
  reason: "公司身分（統編）未確認，不查詢此來源",
} as const;

export type SourceErrorResult = {
  status: "error";
  error: { type: string; message: string };
};

export type SkippedResult = typeof SKIPPED;

export const _deps = {
  getByTaxId: registry.getByTaxId,
  resolveName: registry.resolveName,
  goodjobGet: goodjob.get,
  qollieGet: qollie.get,
  interviewTwGet: interviewTw.get,
  webSearch: web.search,
  buildLinks: links.build,
};

async function safe<T>(fn: () => Promise<T>): Promise<T | SourceErrorResult> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof SourceError) {
      return { status: "error", error: { type: e.type, message: e.message } };
    }
    const errName = e instanceof Error ? e.name : typeof e;
    const errMsg = e instanceof Error ? e.message : String(e);
    return {
      status: "error",
      error: { type: "internal", message: `${errName}: ${errMsg}`.slice(0, 200) },
    };
  }
}

export interface ResearchOptions {
  includeReviews?: boolean;
  reviewLimit?: number;
  tavilyKey?: string | null;
}

export interface ResearchResult {
  query: { input: string; tax_id: string | null; name: string | null };
  company: registry.GetByTaxIdResult | registry.ResolveNameResult | SourceErrorResult;
  goodjob: goodjob.GoodJobResult | SkippedResult | SourceErrorResult;
  qollie: qollie.QollieResult | SkippedResult | SourceErrorResult;
  interview_tw: interviewTw.InterviewTwResult | SkippedResult | SourceErrorResult;
  web: web.WebSearchResult | SourceErrorResult;
  links: links.CompanyLinks;
}

export async function run(
  query: string,
  options: ResearchOptions = {},
): Promise<ResearchResult> {
  const trimmed = (query ?? "").trim();
  if (!trimmed) {
    throw new Error("請提供公司名稱或 8 碼統編");
  }
  const includeReviews = options.includeReviews ?? true;
  const reviewLimit = options.reviewLimit ?? 20;
  const tavilyKey = options.tavilyKey ?? null;

  if (!(reviewLimit >= 1 && reviewLimit <= MAX_REVIEW_LIMIT)) {
    throw new Error(`review_limit 必須介於 1 到 ${MAX_REVIEW_LIMIT}，收到 ${reviewLimit}`);
  }

  let taxId: string | null = /^\d{8}$/.test(trimmed) ? trimmed : null;
  let resolved: registry.ResolveNameResult | SourceErrorResult | null = null;
  if (taxId === null) {
    resolved = await safe(() => _deps.resolveName(trimmed));
    if (resolved.status === "ok") {
      taxId = resolved.tax_id;
    }
  }
  const company = taxId
    ? await safe(() => _deps.getByTaxId(taxId))
    : resolved!;

  const confirmed = company.status === "ok" && "data" in company;
  const name = confirmed ? (company.data.name ?? null) : null;
  const searchName = name || trimmed;
  const opts = { includeReviews, reviewLimit };

  let gj: goodjob.GoodJobResult | SkippedResult | SourceErrorResult = SKIPPED;
  let ql: qollie.QollieResult | SkippedResult | SourceErrorResult = SKIPPED;
  let itw: interviewTw.InterviewTwResult | SkippedResult | SourceErrorResult = SKIPPED;
  let wb: web.WebSearchResult | SourceErrorResult;

  if (confirmed && taxId) {
    [gj, ql, itw, wb] = await Promise.all([
      safe(() => _deps.goodjobGet(taxId, opts)),
      safe(() => _deps.qollieGet(name ?? searchName, taxId, opts)),
      safe(() => _deps.interviewTwGet(name ?? searchName, taxId)),
      safe(() => _deps.webSearch(searchName, tavilyKey)),
    ]);
  } else {
    wb = await safe(() => _deps.webSearch(searchName, tavilyKey));
  }

  const gjData = gj.status === "ok" ? gj.data : undefined;
  const qlData = ql.status === "ok" ? ql.data : undefined;
  const itwData = itw.status === "ok" ? itw.data : undefined;

  return {
    query: { input: trimmed, tax_id: confirmed ? taxId : null, name },
    company,
    goodjob: gj,
    qollie: ql,
    interview_tw: itw,
    web: wb,
    links: _deps.buildLinks(searchName, {
      goodjobName: gjData?.name,
      qollieId: qlData?.company_id,
      itwShortId: itwData?.short_id,
    }),
  };
}
