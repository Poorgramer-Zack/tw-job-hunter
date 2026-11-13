import { type HTMLElement, type Node, NodeType, parse } from "node-html-parser";
import { shortName } from "./common.js";
import { request, SourceError } from "./http.js";

export const SOURCE = "面試趣";
export const BASE = "https://interview.tw";
export const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
export const XHR: Record<string, string> = {
  "User-Agent": UA,
  Accept: "application/json",
  "X-Requested-With": "XMLHttpRequest",
};
export const PAGE: Record<string, string> = {
  "User-Agent": UA,
  "Accept-Language": "zh-TW,zh;q=0.9",
};
export const LABELS: Record<string, string> = {
  面試心得: "interview_count",
  面試評價: "rating",
  錄取率: "offer_rate",
  面試難度: "difficulty",
  平均月薪: "avg_monthly_salary",
  薪水情報: "salary_reports",
};

function collectTextChunks(node: Node, out: string[]): void {
  if (node.nodeType === NodeType.TEXT_NODE) {
    const trimmed = node.text.trim();
    if (trimmed) {
      out.push(trimmed);
    }
    return;
  }
  for (const child of node.childNodes) {
    collectTextChunks(child, out);
  }
}

function extractCompactText(el: HTMLElement | null): string {
  if (!el) {
    return "";
  }
  const chunks: string[] = [];
  collectTextChunks(el, chunks);
  return chunks.join("");
}

function extractStats(root: HTMLElement): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (const item of root.querySelectorAll(".iw_info-item")) {
    const main = extractCompactText(item.querySelector(".iw_main-info"));
    const sub = extractCompactText(item.querySelector(".iw_sub-info"));
    if (sub && sub in LABELS) {
      out[LABELS[sub]] = main;
    }
  }
  if (Object.keys(out).length === 0) {
    throw new SourceError("schema", "面試趣公司頁找不到統計區塊，格式可能已改變");
  }
  return out;
}

function extractJsonLdRating(root: HTMLElement): [number | null, number | null] {
  for (const script of root.querySelectorAll('script[type="application/ld+json"]')) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(script.text);
    } catch {
      continue;
    }
    if (typeof parsed !== "object" || parsed === null) {
      continue;
    }
    const graph = (parsed as Record<string, unknown>)["@graph"];
    if (!Array.isArray(graph)) {
      continue;
    }
    for (const g of graph) {
      if (typeof g === "object" && g !== null && (g as Record<string, unknown>)["@type"] === "WebPage") {
        const mainEntity = (g as Record<string, unknown>).mainEntity as Record<string, unknown> | undefined;
        const ar = mainEntity?.aggregateRating as Record<string, unknown> | undefined;
        if (ar) {
          return [
            (ar.ratingValue as number | null | undefined) ?? null,
            (ar.ratingCount as number | null | undefined) ?? null,
          ];
        }
      }
    }
  }
  return [null, null];
}

export interface InterviewTwData {
  short_id: string;
  url: string;
  salary_url: string;
  interview_count: string | null;
  rating: string | null;
  offer_rate: string | null;
  difficulty: string | null;
  avg_monthly_salary: string | null;
  salary_reports: string | null;
  rating_value: number | null;
  review_count: number | null;
}

export type InterviewTwResult =
  | { status: "not_found" }
  | { status: "ok"; data: InterviewTwData };

interface AutocompleteRow {
  shortId: string;
  code?: string | null;
}

export async function get(name: string, taxId: string): Promise<InterviewTwResult> {
  const ac = await request<{ source?: AutocompleteRow[] } | null>(
    SOURCE,
    "GET",
    `${BASE}/auto-complete/companies`,
    {
      params: { search: shortName(name), limit: 5 },
      headers: XHR,
    },
  );
  const rows = ac && typeof ac === "object" && !Array.isArray(ac) ? ac.source : undefined;
  if (rows === undefined || rows === null) {
    throw new SourceError("schema", "面試趣自動完成回應缺少 source，格式可能已改變");
  }

  const match = rows.find((r) => r.code === taxId);
  if (!match) {
    return { status: "not_found" };
  }

  const sid = match.shortId;
  const html = await request<string>(SOURCE, "GET", `${BASE}/c/${sid}`, {
    headers: PAGE,
    expect: "text",
  });
  const root = parse(html);
  const stats = extractStats(root);

  if (stats.avg_monthly_salary === undefined || stats.avg_monthly_salary === null || stats.avg_monthly_salary === "" || stats.avg_monthly_salary === "-") {
    const sal = await request<{ display?: string | null } | null>(
      SOURCE,
      "GET",
      `${BASE}/c/${sid}/salary-average`,
      { headers: XHR },
    );
    stats.avg_monthly_salary = sal && typeof sal === "object" ? (sal.display ?? null) : null;
  }

  const [ratingValue, reviewCount] = extractJsonLdRating(root);
  return {
    status: "ok",
    data: {
      short_id: sid,
      url: `${BASE}/c/${sid}`,
      salary_url: `https://salary.tw/c/${sid}`,
      interview_count: stats.interview_count ?? null,
      rating: stats.rating ?? null,
      offer_rate: stats.offer_rate ?? null,
      difficulty: stats.difficulty ?? null,
      avg_monthly_salary: stats.avg_monthly_salary ?? null,
      salary_reports: stats.salary_reports ?? null,
      rating_value: ratingValue,
      review_count: reviewCount,
    },
  };
}
