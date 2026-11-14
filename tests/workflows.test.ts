import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(import.meta.dirname, "..");
const CI_WORKFLOW = path.join(ROOT, ".github", "workflows", "ci.yml");
const RELEASE_WORKFLOW = path.join(ROOT, ".github", "workflows", "release.yml");

describe("GitHub Actions workflows", () => {
  it("provides .github/workflows/ci.yml with typecheck, tests, and dist check", () => {
    expect(fs.existsSync(CI_WORKFLOW)).toBe(true);
    const content = fs.readFileSync(CI_WORKFLOW, "utf-8");

    expect(content).toContain("pull_request");
    expect(content).toContain("workflow_call");
    expect(content).toContain("tsc --noEmit");
    expect(content).toContain("npm test");
    expect(content).toContain("npm run check:dist");
    expect(content).toContain("npm ci");
    expect(content).toContain("'24'");
  });

  it("provides .github/workflows/release.yml reusing ci.yml and generating commit changelog without npm publish", () => {
    expect(fs.existsSync(RELEASE_WORKFLOW)).toBe(true);
    const content = fs.readFileSync(RELEASE_WORKFLOW, "utf-8");

    expect(content).toContain("tags:");
    expect(content).toContain("'v*'");
    expect(content).toContain("uses: ./.github/workflows/ci.yml");
    expect(content).toContain("needs: test");
    expect(content).toContain("fetch-depth: 0");
    expect(content).toContain("contents: write");
    expect(content).toContain("What's Changed");
    expect(content).toContain("Full Changelog");
    expect(content).toContain("git log");
    expect(content).toContain("gh release");
    expect(content).not.toContain("npm publish");
  });

  it("tracks dist/server.js as executable (100755) in git index for Linux CI", () => {
    const staged = execFileSync("git", ["ls-files", "--stage", "dist/server.js"], {
      cwd: ROOT,
      encoding: "utf-8",
    });
    expect(staged.startsWith("100755 ")).toBe(true);
  });
});
