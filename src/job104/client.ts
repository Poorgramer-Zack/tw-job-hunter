/**
 * 對 104 發出請求的唯一入口：固定標頭、全域節流、被擋偵測、錯誤分類。
 * 使用 Node 內建 fetch，不帶 cookie。
 */

export const HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36",
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "zh-TW,zh;q=0.9",
};

export const TIMEOUT_MS = 20_000;
export const MIN_INTERVAL_MS = 1_000;

export class Job104Error extends Error {
  readonly type: string = "error";

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = new.target.name;
  }
}

export class Blocked104Error extends Job104Error {
  override readonly type = "blocked";
}

export class Network104Error extends Job104Error {
  override readonly type = "network";
}

export class Schema104Error extends Job104Error {
  override readonly type = "schema";
}

export class NotFound104Error extends Job104Error {
  override readonly type = "not_found";
}

export interface ThrottleClock {
  now: () => number;
  sleep: (ms: number) => Promise<void>;
}

const defaultClock: ThrottleClock = {
  now: () => performance.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

let clock: ThrottleClock = defaultClock;
let last: number | null = null;
let chain: Promise<void> = Promise.resolve();

// 以模組層級 Promise 串列序列化並發呼叫，確保任意兩次請求間隔 >= 1 秒
function throttle(): Promise<void> {
  const run = chain.then(async () => {
    if (last !== null) {
      const wait = MIN_INTERVAL_MS - (clock.now() - last);
      if (wait > 0) {
        await clock.sleep(wait);
      }
    }
    last = clock.now();
  });
  // 單次失敗不應阻塞後續排隊請求
  chain = run.catch(() => {});
  return run;
}

export function _setClockForTest(nextClock?: ThrottleClock): void {
  clock = nextClock ?? defaultClock;
}

export function _resetThrottleForTest(): void {
  last = null;
  chain = Promise.resolve();
}

export async function getJson(
  url: string,
  params?: Record<string, string | number>,
  referer?: string,
): Promise<unknown> {
  await throttle();

  const target = new URL(url);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null) {
        target.searchParams.set(k, String(v));
      }
    }
  }

  const headers: Record<string, string> = referer
    ? { ...HEADERS, Referer: referer }
    : { ...HEADERS };

  let res: Response;
  let body: string;
  try {
    res = await fetch(target.toString(), {
      headers,
      signal: AbortSignal.timeout(TIMEOUT_MS),
      credentials: "omit",
    });
    body = await res.text();
  } catch (err) {
    const name = err instanceof Error ? err.name : "Error";
    throw new Network104Error(`連線 104 失敗：${name}`, { cause: err });
  }

  const ct = res.headers.get("content-type") ?? "";
  const isJson = ct.toLowerCase().includes("json");

  if (
    res.status === 403 ||
    res.status === 429 ||
    (!isJson && (body.includes("challenge-platform") || body.includes("Just a moment")))
  ) {
    throw new Blocked104Error(`被 104 阻擋（HTTP ${res.status}），請稍後再試，不要連續重試`);
  }
  if (res.status === 404) {
    throw new NotFound104Error("104 回應 404");
  }
  if (res.status >= 500) {
    throw new Network104Error(`104 伺服器錯誤（HTTP ${res.status}）`);
  }
  if (!isJson) {
    throw new Schema104Error(`104 回應不是 JSON（HTTP ${res.status}），回應格式可能已改變`);
  }

  try {
    return JSON.parse(body) as unknown;
  } catch (err) {
    throw new Schema104Error("104 回應的 JSON 無法解析，格式可能已改變", { cause: err });
  }
}
