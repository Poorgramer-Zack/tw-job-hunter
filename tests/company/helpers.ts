import fs from "node:fs";
import path from "node:path";
import { vi } from "vitest";

const FIXTURES_COMPANY = path.resolve(import.meta.dirname, "../fixtures/company");

export function loadCompany<T = unknown>(name: string): T {
  const p = path.join(FIXTURES_COMPANY, name);
  const text = fs.readFileSync(p, "utf-8");
  return (name.endsWith(".html") ? text : JSON.parse(text)) as T;
}

export class FakeResponse {
  readonly status: number;
  readonly ok: boolean;
  readonly headers: Headers;
  private readonly _body: string;

  constructor(opts: { status?: number; body?: string; jsonData?: unknown; contentType?: string } = {}) {
    this.status = opts.status ?? 200;
    this.ok = this.status >= 200 && this.status < 300;
    this._body = opts.jsonData !== undefined ? JSON.stringify(opts.jsonData) : (opts.body ?? "");
    this.headers = new Headers({
      "content-type": opts.contentType ?? (opts.jsonData !== undefined ? "application/json" : "text/html; charset=UTF-8"),
    });
  }

  async text(): Promise<string> {
    return this._body;
  }

  async json(): Promise<unknown> {
    return JSON.parse(this._body);
  }
}

export interface RecordedCall {
  method: string;
  url: string;
  params: Record<string, string>;
  json: unknown;
  headers: Record<string, string>;
  signal: AbortSignal | null | undefined;
}

type RouteMatch = string | [string, string];
type RouteResponse = FakeResponse | ((call: RecordedCall) => FakeResponse);

export class FakeHTTP {
  readonly calls: RecordedCall[] = [];
  private readonly routes: Array<{ match: RouteMatch; response: RouteResponse }> = [];

  add(match: RouteMatch, response: RouteResponse): void {
    this.routes.push({ match, response });
  }

  install(): ReturnType<typeof vi.spyOn> {
    return vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const rawUrl = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      const parsed = new URL(rawUrl);
      const params: Record<string, string> = {};
      parsed.searchParams.forEach((v, k) => {
        params[k] = v;
      });
      const method = (init?.method ?? "GET").toUpperCase();
      const headers: Record<string, string> = {};
      if (init?.headers) {
        new Headers(init.headers).forEach((v, k) => {
          headers[k] = v;
        });
      }
      let jsonBody: unknown;
      if (typeof init?.body === "string" && init.body.length > 0) {
        try {
          jsonBody = JSON.parse(init.body);
        } catch {
          jsonBody = undefined;
        }
      }
      const call: RecordedCall = {
        method,
        url: rawUrl,
        params,
        json: jsonBody,
        headers,
        signal: init?.signal,
      };
      this.calls.push(call);

      for (const { match, response } of this.routes) {
        const [m, sub] = Array.isArray(match) ? match : [null, match];
        if ((m === null || m.toUpperCase() === method) && rawUrl.includes(sub)) {
          const res = typeof response === "function" ? response(call) : response;
          return res as unknown as Response;
        }
      }
      throw new Error(`unexpected request: ${method} ${rawUrl}`);
    });
  }
}
