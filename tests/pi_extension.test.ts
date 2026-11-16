import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it, vi } from "vitest";
import ext from "../src/pi-extension.js";

const ROOT = path.resolve(import.meta.dirname, "..");
const EXPECTED_SERVER_PATH = path.resolve(ROOT, "dist", "server.js");

describe("pi extension and package manifest", () => {
  it("declares pi fields, exports, version, and zero runtime host dependencies in package.json", () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf-8"));

    expect(pkg.version).toBe("0.5.2");
    expect(pkg.exports?.["."]).toBe("./dist/opencode-plugin.js");
    expect(pkg.pi?.extensions).toContain("./dist/pi-extension.js");
    expect(pkg.pi?.skills).toContain("./skills");
    expect(pkg.peerDependencies?.["@earendil-works/pi-coding-agent"]).toBe("*");
    expect(pkg.peerDependenciesMeta?.["@earendil-works/pi-coding-agent"]?.optional).toBe(true);

    const depKeys = Object.keys(pkg.dependencies ?? {});
    for (const key of depKeys) {
      expect(key).not.toMatch(/^@earendil-works\//);
      expect(key).not.toContain("typebox");
      expect(key).not.toMatch(/^@opencode\//);
    }
  });

  it("registers tw-job-hunter MCP server with node and existing dist/server.js", () => {
    const fakePi = {
      registerMcpServer: vi.fn(),
    };

    ext(fakePi);

    expect(fakePi.registerMcpServer).toHaveBeenCalledTimes(1);
    expect(fakePi.registerMcpServer).toHaveBeenCalledWith("tw-job-hunter", {
      command: "node",
      args: [EXPECTED_SERVER_PATH],
    });
    expect(fs.existsSync(EXPECTED_SERVER_PATH)).toBe(true);
  });

  it("builds dist/pi-extension.js and dist/opencode-plugin.js", async () => {
    const piDistPath = path.join(ROOT, "dist", "pi-extension.js");
    const openCodeDistPath = path.join(ROOT, "dist", "opencode-plugin.js");
    expect(fs.existsSync(piDistPath)).toBe(true);
    expect(fs.existsSync(openCodeDistPath)).toBe(true);

    const mod = await import(pathToFileURL(piDistPath).href);
    const fakePi = { registerMcpServer: vi.fn() };
    mod.default(fakePi);
    expect(fakePi.registerMcpServer).toHaveBeenCalledWith("tw-job-hunter", {
      command: "node",
      args: [EXPECTED_SERVER_PATH],
    });
  });
});
