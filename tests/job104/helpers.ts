import fs from "node:fs";
import path from "node:path";
import { vi } from "vitest";
import { _resetThrottleForTest, _setClockForTest } from "../../src/job104/client.js";
import { AREA_URL, JOBCAT_URL, _clearCacheForTest } from "../../src/job104/codes.js";

const FIXTURES_DIR = path.resolve(import.meta.dirname, "../fixtures");

export function loadFixture<T = unknown>(name: string): T {
  const raw = fs.readFileSync(path.join(FIXTURES_DIR, name), "utf-8");
  return JSON.parse(raw) as T;
}

export interface FakeResponseOptions {
  status?: number;
  body?: string;
  jsonData?: unknown;
  contentType?: string;
}

export function fakeResponse(opts: FakeResponseOptions = {}): Response {
  const { status = 200, body = "", jsonData, contentType } = opts;
  const hasJson = jsonData !== undefined;
  const payload = hasJson ? JSON.stringify(jsonData) : body;
  const ct = contentType ?? (hasJson ? "application/json" : "text/html; charset=UTF-8");
  return new Response(payload, {
    status,
    headers: { "content-type": ct },
  });
}

export interface RecordedFetchCall {
  url: string;
  fullUrl: string;
  params: Record<string, string>;
  headers: Record<string, string>;
  signal: AbortSignal | null | undefined;
  credentials: RequestCredentials | undefined;
}

export type ResponseFactory =
  | Response
  | ((call: RecordedFetchCall) => Response | Promise<Response>);

export function installFakeFetch(responseFor: ResponseFactory): RecordedFetchCall[] {
  const calls: RecordedFetchCall[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const fullUrl = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const parsed = new URL(fullUrl);
    const call: RecordedFetchCall = {
      url: `${parsed.origin}${parsed.pathname}`,
      fullUrl,
      params: Object.fromEntries(parsed.searchParams.entries()),
      headers: (init?.headers as Record<string, string>) ?? {},
      signal: init?.signal,
      credentials: init?.credentials,
    };
    calls.push(call);
    return typeof responseFor === "function" ? responseFor(call) : responseFor.clone();
  });
  return calls;
}

export function installOfflineCodes(extra?: ResponseFactory): RecordedFetchCall[] {
  const tables: Record<string, unknown> = {
    [AREA_URL]: loadFixture("Area.json"),
    [JOBCAT_URL]: loadFixture("JobCat.json"),
  };
  return installFakeFetch((call) => {
    if (Object.hasOwn(tables, call.url)) {
      return fakeResponse({ jsonData: tables[call.url] });
    }
    if (extra) {
      return typeof extra === "function" ? extra(call) : extra.clone();
    }
    throw new Error(`unexpected fetch: ${call.fullUrl}`);
  });
}

export function resetJob104State(): void {
  _clearCacheForTest();
  _resetThrottleForTest();
  _setClockForTest({ now: () => 0, sleep: async () => {} });
}
