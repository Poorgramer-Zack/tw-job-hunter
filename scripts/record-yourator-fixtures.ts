/**
 * 一次性腳本：錄製 Yourator 公開回應，去識別化並縮短後存到 tests/fixtures/yourator/。
 *
 * 用法：npx tsx scripts/record-yourator-fixtures.ts
 * 每個請求間隔至少 3 秒，匿名唯讀，不帶 cookie，不在測試中執行。
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { type HTMLElement, NodeType, parse } from "node-html-parser";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(__dirname, "..", "tests", "fixtures", "yourator");
const BASE = "https://www.yourator.co";
const MIN_INTERVAL_MS = 3_000;

const XHR_HEADERS: Record<string, string> = {
  "User-Agent": "tw-job-hunter/0.1 (personal research)",
  Accept: "application/json",
  "X-Requested-With": "XMLHttpRequest",
  Referer: `${BASE}/jobs`,
};

const PAGE_HEADERS: Record<string, string> = {
  "User-Agent": "tw-job-hunter/0.1 (personal research)",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "zh-TW,zh;q=0.9",
  Referer: `${BASE}/jobs`,
};

let lastRequestAt = 0;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function pace(): Promise<void> {
  if (lastRequestAt > 0) {
    const waitMs = MIN_INTERVAL_MS - (performance.now() - lastRequestAt);
    if (waitMs > 0) {
      await sleep(waitMs);
    }
  }
  lastRequestAt = performance.now();
}

async function getJson<T>(url: string): Promise<T> {
  await pace();
  const res = await fetch(url, {
    headers: XHR_HEADERS,
    signal: AbortSignal.timeout(30_000),
  });
  console.log(`GET ${url} -> ${res.status}`);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} for ${url}`);
  }
  return (await res.json()) as T;
}

async function getHtml(url: string): Promise<string> {
  await pace();
  const res = await fetch(url, {
    headers: PAGE_HEADERS,
    signal: AbortSignal.timeout(30_000),
  });
  console.log(`GET ${url} -> ${res.status}`);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} for ${url}`);
  }
  return await res.text();
}

function scrubPii(text: string): string {
  return text
    .replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, "[email]")
    .replace(
      /(?:\+?886[-\s]?9\d{2}[-\s]?\d{3}[-\s]?\d{3}|09\d{2}[-\s]?\d{3}[-\s]?\d{3}|\(?0[2-8]\)?[-\s]?\d{3,4}[-\s]?\d{4})/g,
      "[phone]",
    );
}

function scrubJsonStrings(val: unknown): unknown {
  if (typeof val === "string") {
    return scrubPii(val);
  }
  if (Array.isArray(val)) {
    return val.map(scrubJsonStrings);
  }
  if (val !== null && typeof val === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(val)) {
      out[k] = scrubJsonStrings(v);
    }
    return out;
  }
  return val;
}

/** 保留結構，將節點內的純文字累計裁切至約 limit 字元並去除個資字串。 */
function trimElementText(el: HTMLElement, limit = 200): void {
  let remaining = limit;
  const walk = (node: HTMLElement): void => {
    for (const child of [...node.childNodes]) {
      if (child.nodeType === NodeType.TEXT_NODE) {
        const cleaned = scrubPii(child.rawText);
        if (remaining <= 0) {
          child.rawText = "";
        } else if (cleaned.length > remaining) {
          child.rawText = `${cleaned.slice(0, remaining)}…`;
          remaining = 0;
        } else {
          child.rawText = cleaned;
          remaining -= cleaned.length;
        }
      } else if (child.nodeType === NodeType.ELEMENT_NODE) {
        walk(child as HTMLElement);
      }
    }
  };
  walk(el);
}

function sanitizeDetailHtml(rawHtml: string): string {
  const root = parse(rawHtml);

  // 移除所有非 ld+json 的 script（包含第 6 個含 user 個資的 application/json 與 analytics）
  for (const s of root.querySelectorAll("script")) {
    if (s.getAttribute("type") !== "application/ld+json") {
      s.remove();
    }
  }
  for (const el of root.querySelectorAll("style, svg, iframe, noscript")) {
    el.remove();
  }

  // 處理 JSON-LD JobPosting
  const ldScripts: string[] = [];
  for (const s of root.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      const parsed = JSON.parse(s.text) as Record<string, unknown>;
      if (parsed["@type"] === "JobPosting") {
        if (typeof parsed.description === "string") {
          const descRoot = parse(parsed.description);
          trimElementText(descRoot, 200);
          parsed.description = descRoot.toString();
        }
        const cleaned = scrubJsonStrings(parsed);
        ldScripts.push(`<script type="application/ld+json">${JSON.stringify(cleaned)}</script>`);
      }
    } catch {
      // skip invalid JSON-LD
    }
  }

  // 縮短所有 h2.job-heading 區塊（遠端型態與標籤保留完整原文，其餘裁至約 200 字元）
  for (const h2 of root.querySelectorAll("h2.job-heading")) {
    const headingText = h2.text.trim();
    if (headingText === "遠端型態") {
      for (const rc of h2.parentNode?.querySelectorAll(".remote-content") ?? []) {
        trimElementText(rc, 200);
      }
      continue;
    }
    if (headingText === "員工福利") {
      const parent = h2.parentNode as HTMLElement | null;
      if (parent) {
        for (const child of parent.childNodes) {
          if (child.nodeType === NodeType.ELEMENT_NODE && child !== h2) {
            trimElementText(child as HTMLElement, 120);
          }
        }
      }
      continue;
    }
    const sib = h2.nextElementSibling;
    if (sib) {
      trimElementText(sib, 200);
    }
  }

  // 保留基本資訊區塊（含 .basic-info__tag）與所有 h2.job-heading 所在區塊，避免殘留頁面外圍雜訊
  const basicInfo = root.querySelector(".basic-info");
  const seenParents = new Set<HTMLElement>();
  const sections: string[] = [];
  if (basicInfo) {
    trimElementText(basicInfo, 2000);
    sections.push(basicInfo.toString());
  }
  for (const h2 of root.querySelectorAll("h2.job-heading")) {
    const parent = h2.parentNode as HTMLElement | null;
    if (parent && !seenParents.has(parent)) {
      seenParents.add(parent);
      sections.push(parent.toString());
    }
  }

  return [
    "<!doctype html>",
    '<html lang="zh-TW">',
    "<head>",
    '<meta charset="utf-8">',
    ...ldScripts,
    "</head>",
    "<body>",
    ...sections,
    "</body>",
    "</html>",
  ].join("\n");
}

interface ListResponse {
  payload?: {
    jobs?: Array<{ id: number; path: string; name: string }>;
  };
}

async function save(name: string, data: unknown): Promise<void> {
  await mkdir(OUT, { recursive: true });
  const content = typeof data === "string" ? data : JSON.stringify(data, null, 2);
  await writeFile(path.join(OUT, name), content, "utf-8");
  console.log(`saved ${name}`);
}

async function main(): Promise<void> {
  const areas = await getJson(`${BASE}/api/v4/areas`);
  await save("areas.json", scrubJsonStrings(areas));

  const categories = await getJson(`${BASE}/api/v4/job_categories`);
  await save("job_categories.json", scrubJsonStrings(categories));

  const listKeyword = await getJson<ListResponse>(
    `${BASE}/api/v4/jobs?term%5B%5D=python&sort=recent_updated&page=1`,
  );
  await save("list_keyword.json", scrubJsonStrings(listKeyword));

  const listEmpty = await getJson<ListResponse>(
    `${BASE}/api/v4/jobs?term%5B%5D=zzzznonexistent&sort=recent_updated&page=1`,
  );
  await save("list_empty.json", scrubJsonStrings(listEmpty));

  const listRemoteFull = await getJson<ListResponse>(
    `${BASE}/api/v4/jobs?remote_work%5B%5D=full&sort=recent_updated&page=1`,
  );
  await save("list_remote_full.json", scrubJsonStrings(listRemoteFull));

  const listRemotePartial = await getJson<ListResponse>(
    `${BASE}/api/v4/jobs?remote_work%5B%5D=partial&sort=recent_updated&page=1`,
  );
  await save("list_remote_partial.json", scrubJsonStrings(listRemotePartial));

  // 挑選一般職缺（不在 full 或 partial 列表中，且沒有遠端型態或為一般實體職缺）
  const remoteIds = new Set<number>([
    ...(listRemoteFull.payload?.jobs ?? []).map((j) => j.id),
    ...(listRemotePartial.payload?.jobs ?? []).map((j) => j.id),
  ]);
  const ordinaryCandidate = (listKeyword.payload?.jobs ?? []).find((j) => !remoteIds.has(j.id));
  if (!ordinaryCandidate) {
    throw new Error("找不到一般職缺候選");
  }
  const ordinaryHtml = await getHtml(`${BASE}${ordinaryCandidate.path}`);
  await save("detail_ordinary.html", sanitizeDetailHtml(ordinaryHtml));

  // 挑選同時有「完全遠端工作」與「完全遠端面試」的職缺
  let fullHtmlSaved = false;
  for (const job of (listRemoteFull.payload?.jobs ?? []).slice(0, 6)) {
    const html = await getHtml(`${BASE}${job.path}`);
    const texts = parse(html)
      .querySelectorAll(".remote-content")
      .map((el) => el.text.trim());
    if (
      texts.some((t) => t.startsWith("完全遠端工作")) &&
      texts.some((t) => t.startsWith("完全遠端面試"))
    ) {
      await save("detail_remote_full.html", sanitizeDetailHtml(html));
      fullHtmlSaved = true;
      break;
    }
  }
  if (!fullHtmlSaved) {
    throw new Error("前 6 筆完全遠端職缺中找不到同時含完全遠端工作與完全遠端面試的頁面");
  }

  // 挑選同時有「部分遠端工作」與「部分遠端面試」的職缺
  let partialHtmlSaved = false;
  for (const job of (listRemotePartial.payload?.jobs ?? []).slice(0, 6)) {
    const html = await getHtml(`${BASE}${job.path}`);
    const texts = parse(html)
      .querySelectorAll(".remote-content")
      .map((el) => el.text.trim());
    if (
      texts.some((t) => t.startsWith("部分遠端工作")) &&
      texts.some((t) => t.startsWith("部分遠端面試"))
    ) {
      await save("detail_remote_partial.html", sanitizeDetailHtml(html));
      partialHtmlSaved = true;
      break;
    }
  }
  if (!partialHtmlSaved) {
    throw new Error("前 6 筆部分遠端職缺中找不到同時含部分遠端工作與部分遠端面試的頁面");
  }

  console.log("All Yourator fixtures recorded successfully.");
}

await main();
