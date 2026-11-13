import { clip, NOTICE, shortName } from "./common.js";
import { graphql } from "./http.js";

export const SOURCE = "天眼通";
export const URL = "https://www.qollie.com/graphql";
export const HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36",
  Origin: "https://www.qollie.com",
  Referer: "https://www.qollie.com/search",
};
export const FETCH_COMMENTS = 50;

export const SEARCH =
  'query S($k:String){ searchCompanies(query:{kind:"company",keyword:$k,limit:10,page:1}){ _id name taxId } }';
export const STAT =
  "query C($id:ID!){ getCompanyStat(id:$id){ good normal bad total experienced question chat } }";
export const COMMENTS = `query Q($id:ID!){ searchComments(query:{companyId:$id,limit:${FETCH_COMMENTS},page:1}){ _id content pros cons judge category createdAt } }`;

function gql<T>(query: string, variables: Record<string, unknown>, key: string): Promise<T> {
  return graphql<T>(SOURCE, URL, query, variables, key, HEADERS);
}

function formatDate(ms: number | null | undefined): string | null {
  return ms ? new Date(ms).toISOString().slice(0, 10) : null;
}

export interface QollieOptions {
  includeReviews?: boolean;
  reviewLimit?: number;
}

export interface QollieData {
  company_id: string;
  url: string;
  good: number | null;
  normal: number | null;
  bad: number | null;
  total: number | null;
  experienced: number | null;
  question: number | null;
  chat: number | null;
}

export interface QollieReviewItem {
  source: "qollie";
  url: string;
  judge: string | null;
  category: string | null;
  content: string | null;
  pros: string | null;
  cons: string | null;
  posted: string | null;
}

export type QollieResult =
  | { status: "not_found" }
  | { status: "ok"; data: QollieData; reviews?: { notice: string; items: QollieReviewItem[] } };

interface RawCompanyRow {
  _id: string;
  name?: string;
  taxId?: string;
}

interface RawComment {
  _id?: string;
  content?: string | null;
  pros?: string | null;
  cons?: string | null;
  judge?: string | null;
  category?: string | null;
  createdAt?: number | null;
}

export async function get(
  name: string,
  taxId: string,
  options: QollieOptions = {},
): Promise<QollieResult> {
  const includeReviews = options.includeReviews ?? true;
  const reviewLimit = options.reviewLimit ?? 20;

  const rows = (await gql<RawCompanyRow[] | null>(SEARCH, { k: shortName(name) }, "searchCompanies")) ?? [];
  const match = rows.find((r) => r.taxId === taxId);
  if (!match) {
    return { status: "not_found" };
  }

  const cid = match._id;
  const url = `https://www.qollie.com/companies/${cid}`;
  const stat = (await gql<Record<string, number | null> | null>(STAT, { id: cid }, "getCompanyStat")) ?? {};
  const out: QollieResult = {
    status: "ok",
    data: {
      company_id: cid,
      url,
      good: stat.good ?? null,
      normal: stat.normal ?? null,
      bad: stat.bad ?? null,
      total: stat.total ?? null,
      experienced: stat.experienced ?? null,
      question: stat.question ?? null,
      chat: stat.chat ?? null,
    },
  };

  if (includeReviews) {
    const rawComments = (await gql<RawComment[] | null>(COMMENTS, { id: cid }, "searchComments")) ?? [];
    const sorted = [...rawComments]
      .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))
      .slice(0, reviewLimit);
    out.reviews = {
      notice: NOTICE,
      items: sorted.map((c) => ({
        source: "qollie",
        url,
        judge: c.judge ?? null,
        category: c.category ?? null,
        content: clip(c.content ?? null),
        pros: clip(c.pros ?? null),
        cons: clip(c.cons ?? null),
        posted: formatDate(c.createdAt),
      })),
    };
  }

  return out;
}
