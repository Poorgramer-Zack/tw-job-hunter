/**
 * 一次性腳本：錄製公司研調來源的真實回應，去識別化後存到 tests/fixtures/company/。
 *
 * 用法：TAVILY_API_KEY=... npx tsx scripts/record-company-fixtures.ts [gcis|goodjob|qollie|itw|tavily]
 * 每個請求間隔至少 3 秒，共約 15 個請求。
 *
 * 去識別化原則（因為 fixture 會進公開 repo）：
 * - 商工登記是政府開放資料，原樣保留（TSMC 以外負責人姓名換成「測試負責人」）。
 * - GoodJob、天眼通、Tavily：保留結構與統計數字，所有評論與搜尋摘要文字一律換成假文字，id 換成假 id。
 * - 天眼通原始資料含發文者 IP：白名單查詢本來就不取，這裡也不會寫入。
 * - 面試趣：只保留 JSON-LD 的公司資料與統計區塊，不保留任何心得文字。
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { tavily } from "@tavily/core";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(__dirname, "..", "tests", "fixtures", "company");
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
const TAX_ID = "22099131";
const MIN_INTERVAL_MS = 3_000;

let lastRequestAt = 0;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function wait(): Promise<void> {
  if (lastRequestAt > 0) {
    const delay = MIN_INTERVAL_MS - (performance.now() - lastRequestAt);
    if (delay > 0) {
      await sleep(delay);
    }
  }
  lastRequestAt = performance.now();
}

async function save(name: string, obj: unknown): Promise<void> {
  await mkdir(OUT, { recursive: true });
  const content = typeof obj === "string" ? obj : JSON.stringify(obj, null, 1);
  await writeFile(path.join(OUT, name), content, "utf-8");
  console.log("saved", name);
}

function fakeId(prefix: string, i: number): string {
  return `${prefix}${String(i).padStart(22, "0")}`;
}

// ---------- 商工登記 ----------
const GCIS = "https://data.gcis.nat.gov.tw/od/data/api/";

async function gcis(apiId: string, flt: string): Promise<Record<string, unknown>[]> {
  await wait();
  const target = new URL(GCIS + apiId);
  target.searchParams.set("$format", "json");
  target.searchParams.set("$filter", flt);
  target.searchParams.set("$skip", "0");
  target.searchParams.set("$top", "50");

  const res = await fetch(target.toString(), {
    headers: { "User-Agent": "Mozilla/5.0" },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    throw new Error(`GCIS HTTP ${res.status}`);
  }
  const text = await res.text();
  return text.trim() ? (JSON.parse(text) as Record<string, unknown>[]) : [];
}

/** TSMC 以外的負責人是私人姓名，不放進公開 repo。 */
function anonymizeOwner(rows: Record<string, unknown>[]): Record<string, unknown>[] {
  for (const row of rows) {
    if (row.Business_Accounting_NO !== TAX_ID) {
      row.Responsible_Name = "測試負責人";
    }
  }
  return rows;
}

async function recordGcis(): Promise<void> {
  await save(
    "gcis_taxid.json",
    await gcis("5F64D864-61CB-4D0D-8AD9-492047CC1EA6", `Business_Accounting_NO eq ${TAX_ID}`),
  );
  const nameSearch = await gcis(
    "6BBA2268-1367-4B42-9CCA-BC17499EBE8C",
    "Company_Name like 台灣積體電路製造 and Company_Status eq 01",
  );
  await save("gcis_name_search.json", anonymizeOwner(nameSearch.slice(0, 5)));
  const nameAbbrev = await gcis(
    "6BBA2268-1367-4B42-9CCA-BC17499EBE8C",
    "Company_Name like 台積電 and Company_Status eq 01",
  );
  await save("gcis_name_abbrev.json", anonymizeOwner(nameAbbrev.slice(0, 5)));
}

// ---------- GoodJob ----------
const GJ = "https://api.goodjob.life/graphql";
const GJ_QUERY = `query($q:String!){search_companies(query:$q,hasData:false,limit:5){
 id name businessNumber dataCount experienceCount salaryWorkTimeCount policyReviewCount
 salary_work_time_statistics{count average_week_work_time average_estimated_hourly_wage
  overtime_frequency_count{seldom sometimes usually almost_everyday}
  has_overtime_salary_count{yes no unknown} is_overtime_salary_legal_count{yes no unknown} has_compensatory_dayoff_count{yes no unknown}
  job_average_salaries{job_title{name} average_salary{type amount} data_count}}
 companyRatingStatistics{averageRating ratingCount ratingDistribution{rating count}}
 companyAspectRatingStatistics{aspect type averageRating ratingCount}
 topNJobTitles{all{name}}
 interviewExperiencesResult(start:0,limit:2){count interviewExperiences{id title job_title{name} region experience_in_year interview_time{year month} interview_result created_at averageSectionRating sections{subtitle content}}}
 workExperiencesResult(start:0,limit:2){count workExperiences{id title job_title{name} region experience_in_year data_time{year month} week_work_time recommend_to_others created_at averageSectionRating sections{subtitle content}}}}}`;

interface GoodJobExperience {
  id?: string;
  title?: string;
  sections?: Array<{ subtitle?: string; content?: string }>;
}

interface GoodJobCompany {
  interviewExperiencesResult?: { interviewExperiences?: GoodJobExperience[] };
  workExperiencesResult?: { workExperiences?: GoodJobExperience[] };
}

interface GoodJobResponse {
  data: { search_companies: GoodJobCompany[] };
}

async function goodjob(q: string): Promise<GoodJobResponse> {
  await wait();
  const res = await fetch(GJ, {
    method: "POST",
    headers: {
      "User-Agent": "tw-job-hunter/0.1 (personal research)",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query: GJ_QUERY, variables: { q } }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    throw new Error(`GoodJob HTTP ${res.status}`);
  }
  return (await res.json()) as GoodJobResponse;
}

function sanitizeGoodjob(resp: GoodJobResponse): GoodJobResponse {
  for (const c of resp.data.search_companies) {
    const groups = [
      c.interviewExperiencesResult?.interviewExperiences ?? [],
      c.workExperiencesResult?.workExperiences ?? [],
    ];
    for (const items of groups) {
      items.forEach((e, i) => {
        e.id = fakeId("gj", i);
        e.title = `假資料 公司 職稱 ${i}`;
        (e.sections ?? []).forEach((s, j) => {
          s.content = `假評論內容 ${i}-${j}。這是測試用的文字，不是真實使用者的評論。`;
        });
      });
    }
  }
  return resp;
}

async function recordGoodjob(): Promise<void> {
  await save("goodjob_taxid_22099131.json", sanitizeGoodjob(await goodjob(TAX_ID)));
  await save("goodjob_not_found.json", await goodjob("00000000"));
}

// ---------- 天眼通 ----------
const QL = "https://www.qollie.com/graphql";
const QL_HEADERS = {
  "User-Agent": UA,
  Origin: "https://www.qollie.com",
  Referer: "https://www.qollie.com/search",
  "Content-Type": "application/json",
};

async function qollie<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  await wait();
  const res = await fetch(QL, {
    method: "POST",
    headers: QL_HEADERS,
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    throw new Error(`Qollie HTTP ${res.status}`);
  }
  return (await res.json()) as T;
}

async function recordQollie(): Promise<void> {
  const search = await qollie<{
    data: { searchCompanies: Array<{ _id: string; name: string; taxId?: string }> };
  }>(
    `query S($k:String){ searchCompanies(query:{kind:"company",keyword:$k,limit:10,page:1}){ _id name taxId } }`,
    { k: "台積電" },
  );
  await save("qollie_search.json", search);

  const match = search.data.searchCompanies.find((c) => c.taxId === TAX_ID);
  if (!match) {
    throw new Error(`Qollie 找不到統編 ${TAX_ID}`);
  }
  const cid = match._id;

  const stat = await qollie(
    `query C($id:ID!){ getCompanyStat(id:$id){ good normal bad total experienced question chat } }`,
    { id: cid },
  );
  await save("qollie_stat.json", stat);

  const cm = await qollie<{
    data: { searchComments: Array<Record<string, unknown>> };
  }>(
    `query Q($id:ID!){ searchComments(query:{companyId:$id,limit:3,page:1}){ _id content pros cons judge category createdAt } }`,
    { id: cid },
  );
  cm.data.searchComments.forEach((c, i) => {
    c._id = fakeId("ql", i);
    for (const k of ["content", "pros", "cons"] as const) {
      if (c[k]) {
        c[k] = `假評論內容 ${k} ${i}。這是測試用的文字。`;
      }
    }
  });
  await save("qollie_comments.json", cm);
}

// ---------- 面試趣 ----------
const ITW = "https://interview.tw";
const ITW_PAGE = { "User-Agent": UA, "Accept-Language": "zh-TW,zh;q=0.9" };
const ITW_XHR = { ...ITW_PAGE, Accept: "application/json", "X-Requested-With": "XMLHttpRequest" };

async function recordInterviewTw(): Promise<void> {
  await wait();
  const acUrl = new URL(`${ITW}/auto-complete/companies`);
  acUrl.searchParams.set("search", "台灣積體電路製造");
  acUrl.searchParams.set("limit", "5");

  const acRes = await fetch(acUrl.toString(), {
    headers: ITW_XHR,
    signal: AbortSignal.timeout(20_000),
  });
  if (!acRes.ok) {
    throw new Error(`interview.tw autocomplete HTTP ${acRes.status}`);
  }
  const ac = (await acRes.json()) as { source: Array<{ shortId: string; code?: string }> };
  await save("itw_autocomplete.json", ac);

  const found = ac.source.find((c) => c.code === TAX_ID);
  if (!found) {
    throw new Error(`面試趣找不到統編 ${TAX_ID}`);
  }
  const sid = found.shortId;

  await wait();
  const pageRes = await fetch(`${ITW}/c/${sid}`, {
    headers: ITW_PAGE,
    signal: AbortSignal.timeout(20_000),
  });
  if (!pageRes.ok) {
    throw new Error(`interview.tw page HTTP ${pageRes.status}`);
  }
  const html = await pageRes.text();

  // 只保留 JSON-LD 的公司資料（移除 Review/ItemList）與統計區塊；不保留任何心得文字
  let ld: { "@graph"?: Array<Record<string, unknown>> } | null = null;
  for (const m of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
    const parsed = JSON.parse(m[1]) as { "@graph"?: Array<Record<string, unknown>> };
    if (parsed["@graph"]?.some((g) => g["@type"] === "WebPage")) {
      ld = parsed;
    }
  }
  if (!ld?.["@graph"]) {
    throw new Error("面試趣頁面找不到 WebPage JSON-LD");
  }
  const page = ld["@graph"].find((g) => g["@type"] === "WebPage");
  const org = (page?.mainEntity ?? {}) as Record<string, unknown>;
  const keepKeys = ["@type", "name", "alternateName", "taxID", "address", "aggregateRating", "url"];
  const orgMin: Record<string, unknown> = {};
  for (const k of keepKeys) {
    if (k in org) {
      orgMin[k] = org[k];
    }
  }
  const ldMin = { "@context": "https://schema.org", "@graph": [{ "@type": "WebPage", mainEntity: orgMin }] };

  const infoMarker = html.indexOf('class="iw_company-info-list');
  if (infoMarker === -1) {
    throw new Error("面試趣頁面找不到 iw_company-info-list");
  }
  const start = html.lastIndexOf("<div", infoMarker);
  const end = html.indexOf('id="interview-container"', start);
  if (start === -1 || end === -1) {
    throw new Error("面試趣頁面統計區塊邊界解析失敗");
  }
  let info = html.slice(start, end);
  info = info.replace(/<svg[\s\S]*?<\/svg>/g, "");
  info = info.replace(/<div id="interview-container"[\s\S]*/g, "");
  await save(
    "itw_company.html",
    `<html><head><script type="application/ld+json">${JSON.stringify(ldMin)}</script></head><body>${info}</div></body></html>`,
  );

  await wait();
  const salRes = await fetch(`${ITW}/c/${sid}/salary-average`, {
    headers: ITW_XHR,
    signal: AbortSignal.timeout(20_000),
  });
  if (!salRes.ok) {
    throw new Error(`interview.tw salary-average HTTP ${salRes.status}`);
  }
  await save("itw_salary_average.json", await salRes.json());
}

// ---------- Tavily ----------
async function recordTavily(): Promise<void> {
  const key = process.env.TAVILY_API_KEY;
  if (!key) {
    console.log("no TAVILY_API_KEY, skip tavily fixture");
    return;
  }

  await wait();
  const resp = await tavily({ apiKey: key }).search("台灣積體電路製造 面試 薪水 評價", {
    searchDepth: "basic",
    includeDomains: ["dcard.tw", "ptt.cc"],
    maxResults: 3,
  });

  const results = resp.results.map((x, i) => ({
    ...x,
    title: `假標題 ${i}`,
    content: `假摘要 ${i}。這是測試用的文字。`.repeat(5),
    url: x.url.replace(/M\.\d+\.A\.\w+/g, `M.0.A.FAKE${i}`),
  }));

  const sanitized: Record<string, unknown> = { ...resp, results };
  delete sanitized.answer;
  delete sanitized.images;
  delete sanitized.requestId;
  delete sanitized.request_id;
  await save("tavily_search.json", sanitized);
}

const TARGETS: Array<[string, () => Promise<void>]> = [
  ["gcis", recordGcis],
  ["goodjob", recordGoodjob],
  ["qollie", recordQollie],
  ["itw", recordInterviewTw],
  ["tavily", recordTavily],
];

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const only = args.length > 0 ? args : TARGETS.map(([name]) => name);
  for (const [name, fn] of TARGETS) {
    if (only.includes(name)) {
      await fn();
    }
  }
}

await main();
