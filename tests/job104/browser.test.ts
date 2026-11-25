import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as browser from "../../src/job104/browser.js";
import {
  Blocked104Error,
  Network104Error,
  NotFound104Error,
  Schema104Error,
} from "../../src/job104/client.js";
import { installFakeBrowser, resetJob104State } from "./helpers.js";

beforeEach(() => {
  resetJob104State();
});

afterEach(async () => {
  await browser.closeBrowser();
  browser._setBrowserLauncherForTest();
  vi.restoreAllMocks();
});

describe("job104 browser", () => {
  it("launches headless chrome by default and reuses singleton page", async () => {
    const fake = installFakeBrowser();

    const p1 = await browser.getBrowserPage();
    const p2 = await browser.getBrowserPage();

    expect(p1).toBe(p2);
    expect(fake.launchCalls).toHaveLength(1);
    expect(fake.launchCalls[0].headless).toBe(true);
    expect(fake.launchCalls[0].channel).toBe("chrome");
    expect(fake.contextInitScripts).toHaveLength(1);
    expect(fake.contextOptionsCalls[0].userAgent).toContain("Chrome/135.0.0.0");
    expect(fake.contextOptionsCalls[0].userAgent).not.toContain("HeadlessChrome");
  });

  it("falls back to bundled chromium if chrome channel launch fails", async () => {
    let attempts = 0;
    const fake = installFakeBrowser({
      onLaunch: (opts) => {
        attempts += 1;
        if (opts?.channel === "chrome") {
          throw new Error("chrome not found");
        }
      },
    });

    const page = await browser.getBrowserPage();
    expect(page).toBeDefined();
    expect(attempts).toBe(2);
    expect(fake.launchCalls[0].channel).toBe("chrome");
    expect(fake.launchCalls[1].channel).toBeUndefined();
    expect(fake.launchCalls[1].headless).toBe(true);
  });

  it("recreates page if existing page was closed", async () => {
    const fake = installFakeBrowser();

    const p1 = await browser.getBrowserPage();
    await p1.close();
    const p2 = await browser.getBrowserPage();

    expect(p2).not.toBe(p1);
    expect(fake.launchCalls).toHaveLength(1);
  });

  it("closes browser and resets singleton state", async () => {
    const fake = installFakeBrowser();

    const p1 = await browser.getBrowserPage();
    await browser.closeBrowser();
    const p2 = await browser.getBrowserPage();

    expect(p2).not.toBe(p1);
    expect(fake.launchCalls).toHaveLength(2);
    expect(fake.closedBrowsers).toBe(1);
  });

  it("serializes concurrent calls with runExclusive", async () => {
    const order: string[] = [];
    await Promise.all([
      browser.runExclusive(async () => {
        order.push("start-1");
        await new Promise((r) => setTimeout(r, 20));
        order.push("end-1");
      }),
      browser.runExclusive(async () => {
        order.push("start-2");
        order.push("end-2");
      }),
    ]);

    expect(order).toEqual(["start-1", "end-1", "start-2", "end-2"]);
  });

  it("intercepts matching JSON response during goto and cleans up listener", async () => {
    const fake = installFakeBrowser({
      onGoto: async (url, page) => {
        expect(url).toBe("https://www.104.com.tw/jobs/search/?keyword=python");
        page.emitResponse({
          url: "https://www.104.com.tw/jobs/search/api/jobs?keyword=python",
          status: 200,
          jsonData: { data: [{ jobName: "Python" }] },
        });
      },
    });

    const data = await browser.fetchJsonViaBrowser(
      "https://www.104.com.tw/jobs/search/?keyword=python",
      (u) => u.includes("/jobs/search/api/jobs"),
    );

    expect(data).toEqual({ data: [{ jobName: "Python" }] });
    expect(fake.activeResponseListeners()).toBe(0);
  });

  it.each([403, 429])("throws Blocked104Error on intercepted HTTP %i", async (status) => {
    installFakeBrowser({
      onGoto: async (_url, page) => {
        page.emitResponse({
          url: "https://www.104.com.tw/job/ajax/content/8u9za",
          status,
          body: "<html>blocked</html>",
        });
      },
    });

    await expect(
      browser.fetchJsonViaBrowser(
        "https://www.104.com.tw/job/8u9za",
        (u) => u.includes("/job/ajax/content/8u9za"),
      ),
    ).rejects.toThrow(Blocked104Error);
  });

  it("throws NotFound104Error on intercepted 404 even if response body becomes unavailable after redirect", async () => {
    installFakeBrowser({
      onGoto: async (_url, page) => {
        page.emitResponse({
          url: "https://www.104.com.tw/job/ajax/content/00000",
          status: 404,
          textError: new Error(
            "Protocol error (Network.getResponseBody): No resource with given identifier found",
          ),
        });
      },
    });

    await expect(
      browser.fetchJsonViaBrowser(
        "https://www.104.com.tw/job/00000",
        (u) => u.includes("/job/ajax/content/00000"),
      ),
    ).rejects.toThrow(NotFound104Error);
  });

  it("throws NotFound104Error on intercepted 404 or navigation 404", async () => {
    installFakeBrowser({
      onGoto: async () => ({ status: 404 }),
    });

    await expect(
      browser.fetchJsonViaBrowser(
        "https://www.104.com.tw/job/zzzzz",
        (u) => u.includes("/job/ajax/content/zzzzz"),
      ),
    ).rejects.toThrow(NotFound104Error);
  });

  it("throws Network104Error on intercepted 5xx", async () => {
    installFakeBrowser({
      onGoto: async (_url, page) => {
        page.emitResponse({
          url: "https://www.104.com.tw/job/ajax/content/8u9za",
          status: 502,
          body: "bad gateway",
        });
      },
    });

    await expect(
      browser.fetchJsonViaBrowser(
        "https://www.104.com.tw/job/8u9za",
        (u) => u.includes("/job/ajax/content/8u9za"),
      ),
    ).rejects.toThrow(Network104Error);
  });

  it("throws Schema104Error on non-JSON intercepted response", async () => {
    installFakeBrowser({
      onGoto: async (_url, page) => {
        page.emitResponse({
          url: "https://www.104.com.tw/job/ajax/content/8u9za",
          status: 200,
          body: "<html>not json</html>",
        });
      },
    });

    await expect(
      browser.fetchJsonViaBrowser(
        "https://www.104.com.tw/job/8u9za",
        (u) => u.includes("/job/ajax/content/8u9za"),
      ),
    ).rejects.toThrow(Schema104Error);
  });

  it("throws Network104Error on API response timeout and cleans up listener", async () => {
    const fake = installFakeBrowser({
      onGoto: async () => ({ status: 200 }),
    });

    await expect(
      browser.fetchJsonViaBrowser(
        "https://www.104.com.tw/job/8u9za",
        (u) => u.includes("/job/ajax/content/8u9za"),
        { timeoutMs: 20, timeoutMessage: "API 回應逾時" },
      ),
    ).rejects.toThrow(Network104Error);

    expect(fake.activeResponseListeners()).toBe(0);
  });

  it("throws Network104Error when goto itself fails and avoids unhandled rejection", async () => {
    const fake = installFakeBrowser({
      onGoto: async () => {
        throw new Error("net::ERR_CONNECTION_TIMED_OUT");
      },
    });

    await expect(
      browser.fetchJsonViaBrowser(
        "https://www.104.com.tw/job/8u9za",
        (u) => u.includes("/job/ajax/content/8u9za"),
      ),
    ).rejects.toThrow(Network104Error);

    expect(fake.activeResponseListeners()).toBe(0);
  });
});
