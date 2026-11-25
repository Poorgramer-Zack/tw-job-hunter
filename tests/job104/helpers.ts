import fs from "node:fs";
import path from "node:path";
import { vi } from "vitest";
import {
  _resetBrowserForTest,
  _setBrowserLauncherForTest,
  type BrowserLaunchOptions,
  type BrowserLike,
  type PageLike,
  type ResponseLike,
} from "../../src/job104/browser.js";
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

export interface FakePlaywrightResponseSpec {
  url: string;
  status?: number;
  body?: string;
  jsonData?: unknown;
  contentType?: string;
  textError?: Error;
}

export interface FakeBrowserPage extends PageLike {
  emitResponse(spec: FakePlaywrightResponseSpec): void;
}

export interface FakeBrowserOptions {
  onLaunch?: (opts?: BrowserLaunchOptions) => void;
  onGoto?: (
    url: string,
    page: FakeBrowserPage,
  ) => Promise<{ status?: number } | void> | { status?: number } | void;
}

export interface FakeBrowserHarness {
  launchCalls: BrowserLaunchOptions[];
  contextOptionsCalls: Array<{ locale?: string; viewport?: { width: number; height: number }; userAgent?: string }>;
  gotoUrls: string[];
  contextInitScripts: number[];
  closedBrowsers: number;
  activeResponseListeners: () => number;
}

function makeFakePlaywrightResponse(spec: FakePlaywrightResponseSpec): ResponseLike {
  const hasJson = spec.jsonData !== undefined;
  const payload = hasJson ? JSON.stringify(spec.jsonData) : (spec.body ?? "");
  const ct = spec.contentType ?? (hasJson ? "application/json" : "text/html; charset=UTF-8");
  return {
    url: () => spec.url,
    status: () => spec.status ?? 200,
    headers: () => ({ "content-type": ct }),
    text: async () => {
      if (spec.textError) throw spec.textError;
      return payload;
    },
  };
}

export function installFakeBrowser(opts: FakeBrowserOptions = {}): FakeBrowserHarness {
  const launchCalls: BrowserLaunchOptions[] = [];
  const contextOptionsCalls: Array<{
    locale?: string;
    viewport?: { width: number; height: number };
    userAgent?: string;
  }> = [];
  const gotoUrls: string[] = [];
  const contextInitScripts: number[] = [];
  let closedBrowsers = 0;
  const listeners = new Set<(res: ResponseLike) => void>();

  const makePage = (): FakeBrowserPage => {
    let closed = false;
    let currentUrl = "about:blank";
    const page: FakeBrowserPage = {
      url: () => currentUrl,
      isClosed: () => closed,
      on: (_event, fn) => {
        listeners.add(fn);
        return page;
      },
      off: (_event, fn) => {
        listeners.delete(fn);
        return page;
      },
      emitResponse: (spec) => {
        const res = makeFakePlaywrightResponse(spec);
        for (const fn of [...listeners]) {
          fn(res);
        }
      },
      goto: async (url) => {
        currentUrl = url;
        gotoUrls.push(url);
        const nav = await opts.onGoto?.(url, page);
        const navStatus = nav?.status ?? 200;
        return makeFakePlaywrightResponse({ url, status: navStatus, body: "<html></html>" });
      },
      close: async () => {
        closed = true;
      },
    };
    return page;
  };

  _setBrowserLauncherForTest({
    launch: async (launchOpts = {}) => {
      launchCalls.push(launchOpts);
      opts.onLaunch?.(launchOpts);
      const browserObj: BrowserLike = {
        version: () => "135.0.0.0",
        newContext: async (ctxOpts = {}) => {
          contextOptionsCalls.push(ctxOpts);
          return {
            addInitScript: async () => {
              contextInitScripts.push(1);
            },
            newPage: async () => makePage(),
            pages: () => [],
            close: async () => {},
          };
        },
        on: () => browserObj,
        close: async () => {
          closedBrowsers += 1;
        },
      };
      return browserObj;
    },
  });

  return {
    launchCalls,
    contextOptionsCalls,
    gotoUrls,
    contextInitScripts,
    get closedBrowsers() {
      return closedBrowsers;
    },
    activeResponseListeners: () => listeners.size,
  };
}

export function resetJob104State(): void {
  _clearCacheForTest();
  _resetThrottleForTest();
  _setClockForTest({ now: () => 0, sleep: async () => {} });
  _resetBrowserForTest();
  _setBrowserLauncherForTest();
}
