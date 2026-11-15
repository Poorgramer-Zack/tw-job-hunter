import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const MANIFEST = path.resolve(import.meta.dirname, "..", ".claude-plugin", "plugin.json");

describe("plugin manifest", () => {
  it("test_tavily_key_is_optional_sensitive_user_config", () => {
    const raw = JSON.parse(fs.readFileSync(MANIFEST, "utf-8"));
    const cfg = raw.userConfig.tavily_api_key;
    expect(cfg.type).toBe("string");
    expect(cfg.sensitive).toBe(true);
    expect(cfg.default).toBe("");
    expect(cfg.required).toBeFalsy();
    expect(cfg.description).toContain("app.tavily.com");
  });

  it("test_mcp_server_receives_key_through_user_config", () => {
    const raw = JSON.parse(fs.readFileSync(MANIFEST, "utf-8"));
    const server = raw.mcpServers["tw-job-hunter"];
    expect(server.env.TAVILY_API_KEY).toBe("${user_config.tavily_api_key}");
    expect(server.args.join(" ")).toContain("${CLAUDE_PLUGIN_ROOT}");
  });

  it("test_manifest_never_contains_a_real_key", () => {
    const text = fs.readFileSync(MANIFEST, "utf-8");
    expect(text).not.toContain("tvly-");
  });

  it("test_manifest_description_mentions_yourator", () => {
    const raw = JSON.parse(fs.readFileSync(MANIFEST, "utf-8"));
    expect(raw.description).toContain("Yourator");
  });

  it("test_manifest_version_is_0_5_1", () => {
    const raw = JSON.parse(fs.readFileSync(MANIFEST, "utf-8"));
    expect(raw.version).toBe("0.5.1");
  });
});
