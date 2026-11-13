import { tavily, type TavilySearchOptions } from "@tavily/core";
import { clip } from "./common.js";

export const DOMAINS = ["dcard.tw", "ptt.cc"];
export const FETCH_RESULTS = 20;
export const MAX_RESULTS = 10;
export const SNIPPET_LEN = 300;

const SITES: Array<[string, RegExp, Set<string>]> = [
  ["ptt", /ptt\.cc\/bbs\/([^/]+)\//i, new Set(["tech_job", "salary", "soft_job", "changejob"])],
  ["dcard", /dcard\.tw\/f\/([^/]+)\/p\//i, new Set(["job", "tech_job"])],
];

export const NO_KEY_NOTE =
  "未設定 Tavily 金鑰，略過 Dcard 與 PTT 的搜尋；請見 links 自行查看，或到 https://app.tavily.com 申請免費金鑰後在 plugin 設定中填入。";

export interface TavilyClientLike {
  search: (
    query: string,
    options?: TavilySearchOptions,
  ) => Promise<{ results?: Array<{ title?: string; url: string; content?: string }> }>;
}

export const _deps = {
  createClient: (apiKey: string): TavilyClientLike => tavily({ apiKey }),
};

function matchSite(url: string): string | null {
  for (const [site, pattern, boards] of SITES) {
    const m = pattern.exec(url);
    if (m && boards.has(m[1].toLowerCase())) {
      return site;
    }
  }
  return null;
}

export interface WebResultItem {
  source: string;
  title: string | null;
  url: string;
  snippet: string | null;
}

export type WebSearchResult =
  | { status: "skipped"; results: []; note: string }
  | { status: "ok"; truncated: boolean; results: WebResultItem[] }
  | { status: "error"; results: []; error: { type: "web_search"; message: string } };

export async function search(
  name: string,
  apiKey: string | null | undefined,
): Promise<WebSearchResult> {
  if (!apiKey) {
    return { status: "skipped", results: [], note: NO_KEY_NOTE };
  }
  try {
    const client = _deps.createClient(apiKey);
    const resp = await client.search(`"${name}" 面試 薪水 評價`, {
      searchDepth: "basic",
      includeDomains: DOMAINS,
      maxResults: FETCH_RESULTS,
      exactMatch: true,
    });
    const hits: Array<[string, { title?: string; url: string; content?: string }]> = [];
    for (const r of resp.results ?? []) {
      const site = matchSite(r.url);
      if (site) {
        hits.push([site, r]);
      }
    }
    return {
      status: "ok",
      truncated: hits.length > MAX_RESULTS,
      results: hits.slice(0, MAX_RESULTS).map(([site, r]) => ({
        source: site,
        title: r.title ?? null,
        url: r.url,
        snippet: clip(r.content ?? "", SNIPPET_LEN),
      })),
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      status: "error",
      results: [],
      error: { type: "web_search", message: msg.slice(0, 200) },
    };
  }
}
