/**
 * 104 Playwright 隱藏瀏覽器管理與 API 回應攔截。
 * 透過 headless 瀏覽器載入真實 104 網頁並攔截前端觸發的 JSON 回應，取代直接呼叫未公開 API。
 */

import { chromium } from "playwright";
import {
  Blocked104Error,
  Network104Error,
  NotFound104Error,
  TIMEOUT_MS,
  parseJsonResponse,
  throttle,
} from "./client.js";

export interface BrowserLaunchOptions {
  headless?: boolean;
  channel?: string;
  args?: string[];
}

export interface ResponseLike {
  url(): string;
  status(): number;
  headers(): Record<string, string>;
  text(): Promise<string>;
}

export interface PageLike {
  url(): string;
  isClosed(): boolean;
  on(event: "response", fn: (res: ResponseLike) => void): unknown;
  off(event: "response", fn: (res: ResponseLike) => void): unknown;
  goto(
    url: string,
    options?: {
      waitUntil?: "domcontentloaded" | "load" | "networkidle" | "commit";
      timeout?: number;
    },
  ): Promise<ResponseLike | null>;
  close(): Promise<void>;
}

export interface BrowserContextLike {
  addInitScript(fn: () => void): Promise<void>;
  newPage(): Promise<PageLike>;
  pages(): PageLike[];
  close(): Promise<void>;
}

export interface BrowserLike {
  version?(): string;
  newContext(options?: {
    locale?: string;
    viewport?: { width: number; height: number };
    userAgent?: string;
  }): Promise<BrowserContextLike>;
  on(event: "disconnected", fn: () => void): unknown;
  close(): Promise<void>;
}

export interface BrowserLauncher {
  launch(options?: BrowserLaunchOptions): Promise<BrowserLike>;
}

const defaultLauncher: BrowserLauncher = {
  launch: (options) => chromium.launch(options) as unknown as Promise<BrowserLike>,
};

let launcher: BrowserLauncher = defaultLauncher;
let browser: BrowserLike | null = null;
let context: BrowserContextLike | null = null;
let page: PageLike | null = null;
let currentHeadlessState: boolean | null = null;
let queue: Promise<unknown> = Promise.resolve();

const LAUNCH_ARGS = [
  "--no-first-run",
  "--no-default-browser-check",
  "--disable-blink-features=AutomationControlled",
];

function resetState(): void {
  browser = null;
  context = null;
  page = null;
  currentHeadlessState = null;
}

export function _setBrowserLauncherForTest(next?: BrowserLauncher): void {
  launcher = next ?? defaultLauncher;
}

export function _resetBrowserForTest(): void {
  resetState();
  queue = Promise.resolve();
}

async function launchBrowser(headless: boolean): Promise<BrowserLike> {
  try {
    return await launcher.launch({ headless, channel: "chrome", args: LAUNCH_ARGS });
  } catch {
    // 若本機未安裝 Chrome，退回 Playwright 內建 Chromium
    return launcher.launch({ headless, args: LAUNCH_ARGS });
  }
}

function buildUserAgent(version?: string): string {
  const major = version?.split(".")[0] || "131";
  return `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0 Safari/537.36`;
}

/** 取得並複用單一隱藏瀏覽器頁面。 */
export async function getBrowserPage(headless: boolean = true): Promise<PageLike> {
  if (browser && context) {
    if (currentHeadlessState !== null && currentHeadlessState !== headless) {
      await closeBrowser();
    } else {
      if (page && !page.isClosed()) {
        return page;
      }
      const activePages = context.pages().filter((p) => !p.isClosed());
      page = activePages.length > 0 ? activePages[0] : await context.newPage();
      return page;
    }
  }

  browser = await launchBrowser(headless);
  browser.on("disconnected", resetState);

  context = await browser.newContext({
    locale: "zh-TW",
    viewport: { width: 1280, height: 720 },
    userAgent: buildUserAgent(browser.version?.()),
  });
  await context.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => undefined });
  });

  currentHeadlessState = headless;
  page = await context.newPage();
  return page;
}

/** 關閉隱藏瀏覽器並重置單例狀態。 */
export async function closeBrowser(): Promise<void> {
  const activeContext = context;
  const activeBrowser = browser;
  resetState();

  if (activeContext) {
    try {
      await activeContext.close();
    } catch {
      // 忽略關閉時的清理錯誤
    }
  }
  if (activeBrowser) {
    try {
      await activeBrowser.close();
    } catch {
      // 忽略關閉時的清理錯誤
    }
  }
}

/** 序列化工具呼叫，避免平行呼叫互相覆蓋同一頁面的導航。 */
export function runExclusive<T>(fn: () => Promise<T>): Promise<T> {
  const result = queue.then(fn, fn);
  queue = result.catch(() => {});
  return result;
}

function checkHttpStatus(status: number): void {
  if (status === 403 || status === 429) {
    throw new Blocked104Error(`被 104 阻擋（HTTP ${status}），請稍後再試，不要連續重試`);
  }
  if (status === 404) {
    throw new NotFound104Error("104 回應 404");
  }
  if (status >= 500) {
    throw new Network104Error(`104 伺服器錯誤（HTTP ${status}）`);
  }
}

/** 導航至目標網頁並攔截符合條件的 API JSON 回應。 */
export async function waitForJsonResponseDuringGoto(
  targetPage: PageLike,
  targetUrl: string,
  matchUrl: (responseUrl: string) => boolean,
  timeoutMs: number = TIMEOUT_MS,
  timeoutMessage: string = "104 API 回應逾時",
): Promise<unknown> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  let handler: ((res: ResponseLike) => void) | null = null;
  let settled = false;

  const cleanup = () => {
    if (timeoutId) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
    if (handler) {
      targetPage.off("response", handler);
      handler = null;
    }
  };

  const apiDataPromise = new Promise<unknown>((resolve, reject) => {
    timeoutId = setTimeout(() => {
      settled = true;
      cleanup();
      reject(new Network104Error(timeoutMessage));
    }, timeoutMs);

    handler = (response: ResponseLike) => {
      if (!matchUrl(response.url())) return;
      settled = true;
      cleanup();

      void (async () => {
        try {
          const status = response.status();
          // 先依狀態碼快速分類（避免收到 404/403 後頁面立刻跳轉，導致 response.text() 噴 Protocol error）
          checkHttpStatus(status);
          const headers = response.headers();
          const ct = headers["content-type"] ?? "";
          let body: string;
          try {
            body = await response.text();
          } catch (err) {
            const msg = err instanceof Error ? err.message : "Error";
            throw new Network104Error(`讀取 104 回應內容失敗：${msg}`, { cause: err });
          }
          resolve(parseJsonResponse(status, ct, body));
        } catch (err) {
          reject(err);
        }
      })();
    };

    targetPage.on("response", handler);
  });

  // 避免 goto 先失敗時產生 UnhandledPromiseRejection
  apiDataPromise.catch(() => {});

  try {
    let navRes: ResponseLike | null;
    try {
      navRes = await targetPage.goto(targetUrl, {
        waitUntil: "domcontentloaded",
        timeout: timeoutMs,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Error";
      throw new Network104Error(`連線 104 失敗：${msg}`, { cause: err });
    }

    if (!settled && navRes) {
      checkHttpStatus(navRes.status());
    }

    return await apiDataPromise;
  } finally {
    cleanup();
  }
}

export interface FetchViaBrowserOptions {
  headless?: boolean;
  timeoutMs?: number;
  timeoutMessage?: string;
}

/** 透過隱藏瀏覽器導航與攔截取得 104 JSON 資料（含互斥鎖與節流）。 */
export function fetchJsonViaBrowser(
  targetUrl: string,
  matchUrl: (responseUrl: string) => boolean,
  options: FetchViaBrowserOptions = {},
): Promise<unknown> {
  return runExclusive(async () => {
    await throttle();
    const targetPage = await getBrowserPage(options.headless ?? true);
    return waitForJsonResponseDuringGoto(
      targetPage,
      targetUrl,
      matchUrl,
      options.timeoutMs ?? TIMEOUT_MS,
      options.timeoutMessage ?? "104 API 回應逾時",
    );
  });
}
