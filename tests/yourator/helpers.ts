import fs from "node:fs";
import path from "node:path";
import { vi } from "vitest";
import * as http from "../../src/company/http.js";
import { _clearCacheForTest } from "../../src/yourator/codes.js";
import { FakeHTTP, FakeResponse } from "../company/helpers.js";

export { FakeHTTP, FakeResponse };

const FIXTURES_YOURATOR = path.resolve(import.meta.dirname, "../fixtures/yourator");

export function loadYouratorFixture(name: string): string {
  return fs.readFileSync(path.join(FIXTURES_YOURATOR, name), "utf-8");
}

export function loadYouratorJson<T = unknown>(name: string): T {
  return JSON.parse(loadYouratorFixture(name)) as T;
}

export function resetYouratorState(): void {
  _clearCacheForTest();
  http.resetThrottle();
  vi.spyOn(http._clock, "sleep").mockImplementation(async () => {});
}

export function installOfflineYouratorCodes(fakeHttp?: FakeHTTP): FakeHTTP {
  const fh = fakeHttp ?? new FakeHTTP();
  fh.add("/api/v4/areas", new FakeResponse({ jsonData: loadYouratorJson("areas.json") }));
  fh.add("/api/v4/job_categories", new FakeResponse({ jsonData: loadYouratorJson("job_categories.json") }));
  fh.install();
  return fh;
}
