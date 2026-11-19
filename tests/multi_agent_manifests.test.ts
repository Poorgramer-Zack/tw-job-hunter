import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(import.meta.dirname, "..");

describe("codex plugin manifest", () => {
  const pluginPath = path.join(ROOT, ".codex-plugin", "plugin.json");
  const mcpPath = path.join(ROOT, ".codex-plugin", "mcp.json");
  const marketplacePath = path.join(ROOT, ".agents", "plugins", "marketplace.json");

  it("does not place .mcp.json at repo root", () => {
    expect(fs.existsSync(path.join(ROOT, ".mcp.json"))).toBe(false);
  });

  it("provides valid .codex-plugin/plugin.json without placeholders or missing asset refs", () => {
    expect(fs.existsSync(pluginPath)).toBe(true);
    const rawText = fs.readFileSync(pluginPath, "utf-8");
    expect(rawText).not.toContain("[TODO:");

    const manifest = JSON.parse(rawText);
    expect(manifest.name).toBe("tw-job-hunter");
    expect(manifest.version).toBe("0.8.0");
    expect(manifest.license).toBe("MIT");
    expect(manifest.description).toBeTruthy();

    expect(manifest.author).toBeDefined();
    expect(manifest.author.name).toBeTruthy();
    expect(manifest.author.url).toBe("https://github.com/Poorgramer-Zack");
    expect(manifest.author.email).toBeUndefined();

    expect(manifest.homepage).toBe("https://github.com/Poorgramer-Zack/tw-job-hunter");
    expect(manifest.repository).toBe("https://github.com/Poorgramer-Zack/tw-job-hunter");

    expect(manifest.skills).toBe("./skills/");
    expect(fs.existsSync(path.resolve(ROOT, manifest.skills))).toBe(true);

    expect(manifest.mcpServers).toBe("./.codex-plugin/mcp.json");
    expect(fs.existsSync(path.resolve(ROOT, manifest.mcpServers))).toBe(true);

    expect(manifest.hooks).toBeUndefined();
    expect(manifest.apps).toBeUndefined();
    expect(manifest.assets).toBeUndefined();

    const iface = manifest.interface;
    expect(iface).toBeDefined();
    expect(iface.displayName).toBeTruthy();
    expect(iface.shortDescription).toBeTruthy();
    expect(iface.longDescription).toBeTruthy();
    expect(iface.developerName).toBeTruthy();
    expect(iface.category).toBe("Productivity");
    expect(Array.isArray(iface.capabilities)).toBe(true);
    expect(iface.capabilities.length).toBeGreaterThan(0);
    expect(iface.websiteURL).toBe("https://github.com/Poorgramer-Zack/tw-job-hunter");
    expect(Array.isArray(iface.defaultPrompt)).toBe(true);
    expect(iface.defaultPrompt.length).toBeGreaterThan(0);
    expect(iface.defaultPrompt.length).toBeLessThanOrEqual(3);
    for (const prompt of iface.defaultPrompt) {
      expect(typeof prompt).toBe("string");
      expect(prompt.length).toBeLessThanOrEqual(128);
    }

    expect(iface.composerIcon).toBeUndefined();
    expect(iface.logo).toBeUndefined();
    expect(iface.screenshots).toBeUndefined();
  });

  it("provides .codex-plugin/mcp.json pointing to dist/server.js via node", () => {
    expect(fs.existsSync(mcpPath)).toBe(true);
    const mcp = JSON.parse(fs.readFileSync(mcpPath, "utf-8"));
    const server = mcp.mcpServers?.["tw-job-hunter"];
    expect(server).toBeDefined();
    expect(server.command).toBe("node");
    expect(Array.isArray(server.args)).toBe(true);
    expect(server.args).toContain("./dist/server.js");
    expect(server.cwd).toBe(".");
  });

  it("provides .agents/plugins/marketplace.json with local tw-job-hunter entry", () => {
    expect(fs.existsSync(marketplacePath)).toBe(true);
    const marketplace = JSON.parse(fs.readFileSync(marketplacePath, "utf-8"));
    expect(marketplace.name).toBe("tw-job-hunter");
    expect(marketplace.interface?.displayName).toBeTruthy();
    expect(Array.isArray(marketplace.plugins)).toBe(true);
    expect(marketplace.plugins.length).toBeGreaterThan(0);

    const entry = marketplace.plugins[0];
    expect(entry.name).toBe("tw-job-hunter");
    expect(entry.source).toEqual({ source: "local", path: "./" });
    expect(entry.policy).toEqual({
      installation: "AVAILABLE",
      authentication: "ON_INSTALL",
    });
    expect(entry.category).toBe("Productivity");
  });
});

describe("antigravity plugin manifest", () => {
  const pluginPath = path.join(ROOT, ".antigravity-plugin", "plugin.json");
  const mcpConfigPath = path.join(ROOT, "mcp_config.json");

  it("provides valid .antigravity-plugin/plugin.json", () => {
    expect(fs.existsSync(pluginPath)).toBe(true);
    const manifest = JSON.parse(fs.readFileSync(pluginPath, "utf-8"));
    expect(manifest.$schema).toBe("https://antigravity.google/schemas/v1/plugin.json");
    expect(manifest.name).toBe("tw-job-hunter");
    expect(manifest.displayName).toBeTruthy();
    expect(manifest.version).toBe("0.8.0");
    expect(manifest.description).toBeTruthy();
    expect(manifest.logo).toBeUndefined();
  });

  it("provides root mcp_config.json using PLUGIN_ROOT without variables", () => {
    expect(fs.existsSync(mcpConfigPath)).toBe(true);
    const mcpConfig = JSON.parse(fs.readFileSync(mcpConfigPath, "utf-8"));
    const server = mcpConfig.mcpServers?.["tw-job-hunter"];
    expect(server).toBeDefined();
    expect(server.command).toBe("node");
    expect(Array.isArray(server.args)).toBe(true);
    expect(server.args).toContain("${PLUGIN_ROOT}/dist/server.js");
    expect("variables" in server).toBe(false);
    expect("variables" in mcpConfig).toBe(false);
  });
});

describe("package metadata and cross-platform version consistency", () => {
  it("provides package.json distribution metadata and strict files whitelist", () => {
    const pkgPath = path.join(ROOT, "package.json");
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));

    expect(pkg.license).toBe("MIT");
    expect(pkg.author).toBeTruthy();
    expect(pkg.repository).toBeTruthy();
    expect(pkg.homepage).toBe("https://github.com/Poorgramer-Zack/tw-job-hunter");

    expect(Array.isArray(pkg.keywords)).toBe(true);
    for (const kw of ["opencode-plugin", "pi-package", "mcp", "skills"]) {
      expect(pkg.keywords).toContain(kw);
    }

    expect(Array.isArray(pkg.files)).toBe(true);
    for (const requiredEntry of [
      "dist/",
      "skills/",
      ".claude-plugin/",
      ".codex-plugin/",
      ".antigravity-plugin/",
      ".agents/plugins/",
      ".opencode/",
      "mcp_config.json",
      "LICENSE",
      "README.md",
    ]) {
      expect(pkg.files).toContain(requiredEntry);
    }

    for (const forbiddenEntry of [
      "Zack-Resume.pdf",
      "openspec/",
      "research_notes/",
      "reports/",
      ".claude/",
      ".agents/",
      ".agents/skills/",
      "skills-lock.json",
    ]) {
      expect(pkg.files).not.toContain(forbiddenEntry);
    }
  });

  it("keeps version 0.8.0 consistent across all manifests and McpServer", () => {
    const pkgVersion = JSON.parse(
      fs.readFileSync(path.join(ROOT, "package.json"), "utf-8"),
    ).version;
    const claudeVersion = JSON.parse(
      fs.readFileSync(path.join(ROOT, ".claude-plugin", "plugin.json"), "utf-8"),
    ).version;
    const codexVersion = JSON.parse(
      fs.readFileSync(path.join(ROOT, ".codex-plugin", "plugin.json"), "utf-8"),
    ).version;
    const antigravityVersion = JSON.parse(
      fs.readFileSync(path.join(ROOT, ".antigravity-plugin", "plugin.json"), "utf-8"),
    ).version;

    const serverSource = fs.readFileSync(path.join(ROOT, "src", "server.ts"), "utf-8");
    const match = serverSource.match(
      /new\s+McpServer\s*\(\s*\{[^}]*version:\s*["']([^"']+)["']/s,
    );
    expect(match).not.toBeNull();
    const mcpServerVersion = match?.[1];

    expect(pkgVersion).toBe("0.8.0");
    expect(claudeVersion).toBe("0.8.0");
    expect(codexVersion).toBe("0.8.0");
    expect(antigravityVersion).toBe("0.8.0");
    expect(mcpServerVersion).toBe("0.8.0");
  });
});
