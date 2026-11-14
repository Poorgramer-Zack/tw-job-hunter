/**
 * Yourator 地區與職類代碼：中文名稱 -> 參數值。取自公開 API，記憶體快取，不寫入磁碟。
 */

import { SourceError, request } from "../company/http.js";

export const SOURCE = "Yourator";
export const BASE = "https://www.yourator.co";
export const AREA_URL = `${BASE}/api/v4/areas`;
export const CATEGORY_URL = `${BASE}/api/v4/job_categories`;
export const XHR_HEADERS: Record<string, string> = {
  Accept: "application/json",
  "X-Requested-With": "XMLHttpRequest",
  Referer: `${BASE}/jobs`,
};

interface CodeEntry {
  value: string;
  display: string;
}

const cache = new Map<string, Map<string, CodeEntry>>();

function norm(name: string): string {
  return name.trim().replaceAll("臺", "台");
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function parseAreas(payload: unknown): Map<string, CodeEntry> {
  const inner = isRecord(payload) && isRecord(payload.payload) ? payload.payload : null;
  const areas = inner?.areas;
  if (!Array.isArray(areas)) {
    throw new SourceError("schema", "Yourator 地區回應格式可能已改變");
  }
  const out = new Map<string, CodeEntry>();
  for (const row of areas) {
    if (isRecord(row) && typeof row.value === "string" && typeof row.name === "string") {
      out.set(norm(row.name), { value: row.value, display: row.name });
    }
  }
  if (out.size === 0) {
    throw new SourceError("schema", "Yourator 地區清單為空，格式可能已改變");
  }
  return out;
}

function parseCategories(payload: unknown): Map<string, CodeEntry> {
  const inner = isRecord(payload) && isRecord(payload.payload) ? payload.payload : null;
  const groups = inner?.categoryGroups;
  if (!Array.isArray(groups)) {
    throw new SourceError("schema", "Yourator 職類回應格式可能已改變");
  }
  const out = new Map<string, CodeEntry>();
  for (const g of groups) {
    if (!isRecord(g) || !Array.isArray(g.jobCategories)) continue;
    for (const c of g.jobCategories) {
      if (isRecord(c) && typeof c.name === "string") {
        out.set(norm(c.name), { value: c.name, display: c.name });
      }
    }
  }
  if (out.size === 0) {
    throw new SourceError("schema", "Yourator 職類清單為空，格式可能已改變");
  }
  return out;
}

async function table(url: string, parser: (payload: unknown) => Map<string, CodeEntry>): Promise<Map<string, CodeEntry>> {
  let out = cache.get(url);
  if (!out) {
    const data = await request<unknown>(SOURCE, "GET", url, { headers: XHR_HEADERS });
    out = parser(data);
    cache.set(url, out);
  }
  return out;
}

async function lookup(
  url: string,
  parser: (payload: unknown) => Map<string, CodeEntry>,
  name: string,
  kind: string,
): Promise<string> {
  const key = norm(name);
  if (!key) {
    throw new Error(`${kind}名稱不可為空`);
  }
  const t = await table(url, parser);
  const exact = t.get(key);
  if (exact !== undefined) return exact.value;

  const hits: CodeEntry[] = [];
  for (const [k, entry] of t.entries()) {
    if (k.includes(key)) hits.push(entry);
  }
  if (hits.length === 1) return hits[0].value;
  if (hits.length === 0) {
    const available = [...t.values()].map((e) => e.display).join("、");
    throw new Error(`無法辨識的${kind}：「${name}」，可用${kind}：${available}`);
  }
  throw new Error(
    `${kind}「${name}」有多個符合：${hits.slice(0, 10).map((h) => h.display).join("、")}，請指定更明確的名稱`,
  );
}

export async function areaCode(name: string): Promise<string> {
  return lookup(AREA_URL, parseAreas, name, "地區");
}

export async function categoryCode(name: string): Promise<string> {
  return lookup(CATEGORY_URL, parseCategories, name, "職類");
}

export function _clearCacheForTest(): void {
  cache.clear();
}
