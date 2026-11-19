import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import plugin, {
  type OpenCodeEditor,
  type OpenCodeMcpConfig,
} from "../src/opencode-plugin.js";

const ROOT = path.resolve(import.meta.dirname, "..");
const EXPECTED_SERVER_PATH = path.resolve(ROOT, "dist", "server.js");
const DIST_PLUGIN_PATH = path.resolve(ROOT, "dist", "opencode-plugin.js");
const LOCAL_OPENCODE_PLUGIN_PATH = path.resolve(
  ROOT,
  ".opencode",
  "plugins",
  "tw-job-hunter.js",
);
const EXPECTED_SKILLS = [
  "autobiography",
  "cover-letter",
  "job-fit",
  "job-hunt-flow",
  "resume-advisor",
];

function createEditor<T>(initial: Record<string, T> = {}): OpenCodeEditor<T> {
  const store = new Map<string, T>(Object.entries(initial));
  return {
    list() {
      return [...store.values()];
    },
    get(id: string) {
      return store.get(id);
    },
    set(id: string, value: T) {
      store.set(id, value);
    },
    add(value: T & { id: string }) {
      store.set(value.id, value);
    },
  };
}

describe("opencode plugin (v2 + v1)", () => {
  it("exports id, setup (v2), and server (v1)", () => {
    expect(plugin).toBeTypeOf("object");
    expect(plugin.id).toBe("tw-job-hunter");
    expect(plugin.setup).toBeTypeOf("function");
    expect(plugin.server).toBeTypeOf("function");
  });

  it("registers local MCP server and five skills in v2 setup(ctx)", async () => {
    const mcpEditor = createEditor<OpenCodeMcpConfig>();
    const skillEditor = createEditor<{
      id: string;
      name: string;
      description: string;
      path: string;
      content: string;
    }>();

    await plugin.setup({
      mcp: {
        transform(cb) {
          return cb(mcpEditor);
        },
      },
      skill: {
        transform(cb) {
          return cb(skillEditor);
        },
      },
    });

    const mcpEntry = mcpEditor.get("tw-job-hunter");
    expect(mcpEntry).toEqual({
      type: "local",
      command: ["node", EXPECTED_SERVER_PATH],
    });
    expect(fs.existsSync(EXPECTED_SERVER_PATH)).toBe(true);

    const registeredSkills = skillEditor.list();
    expect(registeredSkills.map((s) => s.id).sort()).toEqual(EXPECTED_SKILLS);

    for (const skill of registeredSkills) {
      expect(skill.name).toBeTruthy();
      expect(skill.description).toBeTruthy();
      expect(path.isAbsolute(skill.path)).toBe(true);
      expect(fs.existsSync(skill.path)).toBe(true);
      expect(skill.path).toBe(path.resolve(ROOT, "skills", skill.id, "SKILL.md"));
      expect(skill.content.trim().length).toBeGreaterThan(0);
    }
  });

  it("does not overwrite existing user skills with the same id", async () => {
    const existing = {
      id: "job-fit",
      name: "custom-job-fit",
      description: "user override",
      path: "/custom/SKILL.md",
      content: "custom content",
    };
    const mcpEditor = createEditor<OpenCodeMcpConfig>();
    const skillEditor = createEditor({ "job-fit": existing });

    await plugin.setup({
      mcp: {
        transform(cb) {
          return cb(mcpEditor);
        },
      },
      skill: {
        transform(cb) {
          return cb(skillEditor);
        },
      },
    });

    expect(skillEditor.get("job-fit")).toEqual(existing);
    expect(skillEditor.list().map((s) => s.id).sort()).toEqual(EXPECTED_SKILLS);
  });

  it("returns v1 config hook setting cfg.mcp['tw-job-hunter']", async () => {
    const hooks = await plugin.server();
    expect(hooks.config).toBeTypeOf("function");

    const cfg: Record<string, unknown> = {};
    await hooks.config(cfg);

    expect(cfg.mcp).toEqual({
      "tw-job-hunter": {
        type: "local",
        command: ["node", EXPECTED_SERVER_PATH],
        enabled: true,
      },
    });
  });

  it("builds dist/opencode-plugin.js and dynamically resolves paths", async () => {
    expect(fs.existsSync(DIST_PLUGIN_PATH)).toBe(true);
    const distCode = fs.readFileSync(DIST_PLUGIN_PATH, "utf-8");
    expect(distCode).not.toContain("D:\\workspace");
    expect(distCode).not.toContain("D:/workspace");

    const mod = await import(pathToFileURL(DIST_PLUGIN_PATH).href);
    const distPlugin = mod.default;
    expect(distPlugin.id).toBe("tw-job-hunter");
    expect(distPlugin.setup).toBeTypeOf("function");
    expect(distPlugin.server).toBeTypeOf("function");

    const hooks = await distPlugin.server();
    const cfg: Record<string, unknown> = {};
    await hooks.config(cfg);
    expect((cfg.mcp as Record<string, { command: string[] }>)["tw-job-hunter"].command[1]).toBe(
      EXPECTED_SERVER_PATH,
    );
  });

  it("exposes .opencode/plugins/tw-job-hunter.js re-exporting dist/opencode-plugin.js", async () => {
    expect(fs.existsSync(LOCAL_OPENCODE_PLUGIN_PATH)).toBe(true);

    const localMod = await import(pathToFileURL(LOCAL_OPENCODE_PLUGIN_PATH).href);
    const distMod = await import(pathToFileURL(DIST_PLUGIN_PATH).href);

    const localPlugin = localMod.default;
    expect(localPlugin).toBe(distMod.default);
    expect(localPlugin.id).toBe("tw-job-hunter");
    expect(typeof localPlugin.setup).toBe("function");
    expect(typeof localPlugin.server).toBe("function");

    const mcpEditor = createEditor<OpenCodeMcpConfig>();
    const skillEditor = createEditor<{
      id: string;
      name: string;
      description: string;
      path: string;
      content: string;
    }>();

    await localPlugin.setup({
      mcp: {
        transform(cb: (editor: OpenCodeEditor<OpenCodeMcpConfig>) => unknown) {
          return cb(mcpEditor);
        },
      },
      skill: {
        transform(
          cb: (
            editor: OpenCodeEditor<{
              id: string;
              name: string;
              description: string;
              path: string;
              content: string;
            }>,
          ) => unknown,
        ) {
          return cb(skillEditor);
        },
      },
    });

    expect(mcpEditor.get("tw-job-hunter")).toEqual({
      type: "local",
      command: ["node", EXPECTED_SERVER_PATH],
    });
    expect(skillEditor.list().map((s) => s.id).sort()).toEqual(EXPECTED_SKILLS);
    for (const skill of skillEditor.list()) {
      expect(skill.path).toBe(path.resolve(ROOT, "skills", skill.id, "SKILL.md"));
    }
  });
});
