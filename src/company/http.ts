export const TIMEOUT = 30;
export const TIMEOUT_MS = TIMEOUT * 1000;
export const MIN_INTERVAL_MS = 2000;
export const DEFAULT_HEADERS: Record<string, string> = {
  "User-Agent": "tw-job-hunter/0.1 (personal research)",
};

export type SourceErrorType = "blocked" | "http" | "network" | "schema";

export class SourceError extends Error {
  readonly type: SourceErrorType;

  constructor(type: SourceErrorType, message: string) {
    super(message);
    this.name = "SourceError";
    this.type = type;
  }
}

export const _clock = {
  now: (): number => performance.now(),
  sleep: (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms)),
};

export const _last = new Map<string, number>();
const _queues = new Map<string, Promise<void>>();

export function resetThrottle(): void {
  _queues.clear();
  _last.clear();
}

async function throttle(source: string): Promise<void> {
  const prev = _queues.get(source) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  _queues.set(source, prev.catch(() => {}).then(() => gate));
  await prev.catch(() => {});
  try {
    const last = _last.get(source) ?? -Infinity;
    const waitMs = MIN_INTERVAL_MS - (_clock.now() - last);
    if (waitMs > 0) {
      await _clock.sleep(waitMs);
    }
    _last.set(source, _clock.now());
  } finally {
    release();
  }
}

export interface RequestOptions {
  params?: Record<string, string | number | boolean | null | undefined>;
  json?: unknown;
  headers?: Record<string, string>;
  expect?: "json" | "text";
  allowEmpty?: boolean;
}

export async function request<T = unknown>(
  source: string,
  method: string,
  url: string,
  options: RequestOptions = {},
): Promise<T> {
  const { params, json, headers, expect = "json", allowEmpty = false } = options;
  await throttle(source);

  let finalUrl = url;
  if (params) {
    const u = new URL(url);
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null) {
        u.searchParams.set(k, String(v));
      }
    }
    finalUrl = u.toString();
  }

  const mergedHeaders: Record<string, string> = { ...DEFAULT_HEADERS, ...(headers ?? {}) };
  let body: string | undefined;
  if (json !== undefined) {
    if (!Object.keys(mergedHeaders).some((k) => k.toLowerCase() === "content-type")) {
      mergedHeaders["Content-Type"] = "application/json";
    }
    body = JSON.stringify(json);
  }

  let res: Response;
  try {
    res = await fetch(finalUrl, {
      method,
      headers: mergedHeaders,
      body,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (e) {
    const name = e instanceof Error ? e.name : String(e);
    throw new SourceError("network", `連線 ${source} 失敗：${name}`);
  }

  if (res.status === 403 || res.status === 429) {
    throw new SourceError("blocked", `被 ${source} 阻擋（HTTP ${res.status}），請稍後再試`);
  }
  if (res.status >= 400) {
    throw new SourceError("http", `${source} 回應錯誤（HTTP ${res.status}）`);
  }

  let text: string;
  try {
    text = await res.text();
  } catch (e) {
    const name = e instanceof Error ? e.name : String(e);
    throw new SourceError("network", `連線 ${source} 失敗：${name}`);
  }

  if (text.length === 0) {
    if (allowEmpty) {
      return null as T;
    }
    throw new SourceError("schema", `${source} 回應內容為空，格式可能已改變`);
  }

  if (expect === "text") {
    return text as T;
  }

  try {
    return JSON.parse(text) as T;
  } catch {
    throw new SourceError("schema", `${source} 回應不是有效的 JSON，格式可能已改變`);
  }
}

export async function graphql<T = unknown>(
  source: string,
  url: string,
  query: string,
  variables: Record<string, unknown>,
  key: string,
  headers?: Record<string, string>,
): Promise<T> {
  const payload = await request<unknown>(source, "POST", url, {
    json: { query, variables },
    headers,
  });
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    throw new SourceError("schema", `${source} 回應含錯誤或缺少 ${key}，格式可能已改變`);
  }
  const obj = payload as Record<string, unknown>;
  const errors = obj.errors;
  const hasErrors = Array.isArray(errors) ? errors.length > 0 : Boolean(errors);
  const data = obj.data;
  if (hasErrors || typeof data !== "object" || data === null || Array.isArray(data) || !(key in data)) {
    throw new SourceError("schema", `${source} 回應含錯誤或缺少 ${key}，格式可能已改變`);
  }
  return (data as Record<string, unknown>)[key] as T;
}
