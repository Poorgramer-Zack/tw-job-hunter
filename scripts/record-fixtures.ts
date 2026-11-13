/**
 * 一次性腳本：錄製 104 真實回應到 tests/fixtures/，並實測有爭議的搜尋參數。
 *
 * 用法：npx tsx scripts/record-fixtures.ts [--probe]
 * 每次請求間隔至少 3 秒。--probe 會多發幾個請求驗證參數語意。
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.resolve(__dirname, "..", "tests", "fixtures");
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36";
const HEADERS = {
  "User-Agent": UA,
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "zh-TW,zh;q=0.9",
};
const SEARCH_URL = "https://www.104.com.tw/jobs/search/api/jobs";
const MIN_INTERVAL_MS = 3_000;

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

async function getJson(
  url: string,
  params?: Record<string, string | number>,
  referer = "https://www.104.com.tw/jobs/search/",
): Promise<Record<string, unknown> | unknown[] | null> {
  await pace();
  const target = new URL(url);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      target.searchParams.set(k, String(v));
    }
  }

  const res = await fetch(target.toString(), {
    headers: { ...HEADERS, Referer: referer },
    signal: AbortSignal.timeout(20_000),
  });
  const ct = res.headers.get("content-type") ?? "";
  const body = await res.text();
  console.log(`GET ${target.toString()}\n  -> ${res.status} ${ct.slice(0, 30)}`);
  if (res.status !== 200 || !ct.includes("json")) {
    console.log("  BODY:", body.slice(0, 200).replace(/\n/g, " "));
    return null;
  }
  return JSON.parse(body) as Record<string, unknown> | unknown[];
}

async function save(name: string, obj: unknown): Promise<void> {
  await mkdir(FIX, { recursive: true });
  await writeFile(path.join(FIX, name), JSON.stringify(obj, null, 1), "utf-8");
  console.log(`  saved ${name}`);
}

interface SearchJob {
  link?: { job?: string };
  jobName?: string;
  salaryDesc?: string;
  periodDesc?: string;
  optionEdu?: string;
  jobType?: string;
  remoteWorkType?: unknown;
  [key: string]: unknown;
}

interface SearchResponse {
  data?: SearchJob[];
  metadata?: { pagination?: { total?: unknown } };
}

async function record(): Promise<void> {
  const s = (await getJson(SEARCH_URL, {
    keyword: "python",
    page: 1,
    pagesize: 20,
    order: 15,
  })) as SearchResponse | null;
  if (!s) {
    console.error("search failed");
    process.exit(1);
  }
  await save("search.json", s);

  const jobLink = s.data?.[0]?.link?.job ?? "";
  const slug = jobLink.replace(/\/+$/, "").split("/").pop()?.split("?")[0] ?? "";
  if (slug) {
    const d = await getJson(
      `https://www.104.com.tw/job/ajax/content/${slug}`,
      undefined,
      `https://www.104.com.tw/job/${slug}`,
    );
    if (d) {
      await save("detail.json", d);
    }
  }

  const area = await getJson("https://static.104.com.tw/category-tool/json/Area.json");
  if (area) {
    await save("Area.json", area);
  }
  const cat = await getJson("https://static.104.com.tw/category-tool/json/JobCat.json");
  if (cat) {
    await save("JobCat.json", cat);
  }

  // 已下架職缺：用一個不太可能存在的代碼
  await pace();
  const gone = await fetch("https://www.104.com.tw/job/ajax/content/zzzzz", {
    headers: { ...HEADERS, Referer: "https://www.104.com.tw/job/zzzzz" },
    signal: AbortSignal.timeout(20_000),
  });
  const goneBody = await gone.text();
  console.log("closed-job probe:", gone.status, goneBody.slice(0, 200).replace(/\n/g, " "));
  await save("detail_closed.txt", { status: gone.status, body: goneBody.slice(0, 2000) });
}

function summarize(label: string, s: SearchResponse | null, key?: string): void {
  if (!s) {
    console.log(`  [${label}] FAILED`);
    return;
  }
  const jobs = s.data ?? [];
  const total = s.metadata?.pagination?.total;
  console.log(`  [${label}] total=${String(total)} page_count=${jobs.length}`);
  if (key && jobs.length > 0) {
    const counts = new Map<unknown, number>();
    for (const j of jobs) {
      const val = j[key];
      counts.set(val, (counts.get(val) ?? 0) + 1);
    }
    console.log("   ", key, Object.fromEntries(counts));
  }
  for (const j of jobs.slice(0, 3)) {
    console.log(
      "    -",
      j.jobName,
      "|",
      j.salaryDesc,
      "|",
      j.periodDesc,
      "|",
      j.optionEdu,
      "|",
      j.jobType,
      "| remote",
      j.remoteWorkType,
    );
  }
}

async function probe(): Promise<void> {
  const base = { keyword: "python", page: 1, pagesize: 20, order: 15 };
  summarize("remoteWork=1", (await getJson(SEARCH_URL, { ...base, remoteWork: 1 })) as SearchResponse | null, "remoteWorkType");
  summarize("remoteWork=2", (await getJson(SEARCH_URL, { ...base, remoteWork: 2 })) as SearchResponse | null, "remoteWorkType");
  summarize("scmin=60000 M strict", (await getJson(SEARCH_URL, { ...base, scmin: 60000, sctp: "M", scstrict: 1 })) as SearchResponse | null);
  summarize(
    "scmin=60000 M strict scneg=0",
    (await getJson(SEARCH_URL, { ...base, scmin: 60000, sctp: "M", scstrict: 1, scneg: 0 })) as SearchResponse | null,
  );
  summarize("jobexp=3 (3-5y?)", (await getJson(SEARCH_URL, { ...base, jobexp: 3 })) as SearchResponse | null, "periodDesc");
  summarize("edu=4 (大學?)", (await getJson(SEARCH_URL, { ...base, edu: 4 })) as SearchResponse | null, "optionEdu");
  summarize("ro=1 (全職?)", (await getJson(SEARCH_URL, { ...base, ro: 1 })) as SearchResponse | null, "jobType");
  summarize("ro=2 (兼職?)", (await getJson(SEARCH_URL, { ...base, ro: 2 })) as SearchResponse | null, "jobType");
  summarize("order=16", (await getJson(SEARCH_URL, { ...base, order: 16 })) as SearchResponse | null);
}

async function main(): Promise<void> {
  await record();
  if (process.argv.includes("--probe")) {
    await probe();
  }
}

await main();
