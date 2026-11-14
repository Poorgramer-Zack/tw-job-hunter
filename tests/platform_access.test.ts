import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(import.meta.dirname, "..");
const SRC_DIR = path.join(ROOT, "src");
const DIST_ENTRY = path.join(ROOT, "dist", "server.js");

const CAKE_HOST_RE = /(?:^|[^a-z0-9.-])(?:[a-z0-9-]+\.)*(?:cake\.me|cakeresume\.com)(?=$|[^a-z0-9.-])/i;

function findCakeHost(text: string): boolean {
  return CAKE_HOST_RE.test(text);
}

function collectTsFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectTsFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith(".ts")) {
      files.push(fullPath);
    }
  }
  return files;
}

describe("platform access guard", () => {
  it("src 不含 Cake 網域", () => {
    const tsFiles = collectTsFiles(SRC_DIR);
    expect(tsFiles.length).toBeGreaterThan(0);
    for (const file of tsFiles) {
      const content = fs.readFileSync(file, "utf-8");
      expect(findCakeHost(content), path.relative(ROOT, file)).toBe(false);
    }
  });

  it("dist/server.js 不含 Cake 網域", () => {
    expect(fs.existsSync(DIST_ENTRY)).toBe(true);
    const content = fs.readFileSync(DIST_ENTRY, "utf-8");
    expect(findCakeHost(content)).toBe(false);
  });

  it("守門比對函式能辨識 Cake 網域且不誤判其他平台", () => {
    expect(findCakeHost("https://www.cake.me/jobs/1")).toBe(true);
    expect(findCakeHost("https://www.cakeresume.com/companies/acme")).toBe(true);
    expect(findCakeHost("https://cake.me/jobs")).toBe(true);
    expect(findCakeHost("https://www.yourator.co/jobs")).toBe(false);
    expect(findCakeHost("https://www.104.com.tw/job/abc")).toBe(false);
  });
});
