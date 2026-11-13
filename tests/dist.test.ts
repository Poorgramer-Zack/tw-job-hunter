import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const DIST_ENTRY = path.resolve(import.meta.dirname, "..", "dist", "server.js");

describe("dist bundle", () => {
  it("dist/server.js exists and is non-empty", () => {
    expect(fs.existsSync(DIST_ENTRY)).toBe(true);
    const stat = fs.statSync(DIST_ENTRY);
    expect(stat.isFile()).toBe(true);
    expect(stat.size).toBeGreaterThan(0);
  });
});
