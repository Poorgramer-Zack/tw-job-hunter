/**
 * 104 地區與職類代碼：中文名稱 -> 代碼。程序內快取，每次啟動重新下載。
 */

import { getJson } from "./client.js";

export const AREA_URL = "https://static.104.com.tw/category-tool/json/Area.json";
export const JOBCAT_URL = "https://static.104.com.tw/category-tool/json/JobCat.json";
export const REFERER = "https://www.104.com.tw/jobs/search/";

interface CodeNode {
  no: string;
  des: string;
  n?: CodeNode[];
}

const cache = new Map<string, Map<string, string>>();

function norm(name: string): string {
  return name.trim().replaceAll("臺", "台");
}

function flatten(nodes: unknown, out: Map<string, string>): void {
  if (!Array.isArray(nodes)) return;
  for (const node of nodes as CodeNode[]) {
    out.set(norm(node.des), node.no);
    if (node.n) flatten(node.n, out);
  }
}

async function table(url: string): Promise<Map<string, string>> {
  let out = cache.get(url);
  if (!out) {
    out = new Map<string, string>();
    flatten(await getJson(url, undefined, REFERER), out);
    cache.set(url, out);
  }
  return out;
}

async function lookup(url: string, name: string, kind: string): Promise<string> {
  const t = await table(url);
  const key = norm(name);
  const exact = t.get(key);
  if (exact !== undefined) return exact;

  const hits: string[] = [];
  for (const k of t.keys()) {
    if (k.includes(key)) hits.push(k);
  }
  if (hits.length === 1) return t.get(hits[0])!;
  if (hits.length === 0) {
    throw new Error(`無法辨識的${kind}：「${name}」`);
  }
  throw new Error(
    `${kind}「${name}」有多個符合：${hits.slice(0, 10).join("、")}，請指定更明確的名稱`,
  );
}

export async function areaCode(name: string): Promise<string> {
  return lookup(AREA_URL, name, "地區");
}

export async function jobcatCode(name: string): Promise<string> {
  return lookup(JOBCAT_URL, name, "職類");
}

export function _clearCacheForTest(): void {
  cache.clear();
}
