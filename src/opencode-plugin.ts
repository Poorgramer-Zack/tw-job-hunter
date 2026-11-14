import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const SERVER_PATH = path.resolve(ROOT, "dist", "server.js");
const SKILLS_DIR = path.resolve(ROOT, "skills");

export interface OpenCodeMcpConfig {
  type: "local";
  command: string[];
  enabled?: boolean;
}

export interface OpenCodeSkillEntry {
  id: string;
  name: string;
  description: string;
  path: string;
  content: string;
}

export interface OpenCodeEditor<T> {
  list(): T[];
  get(id: string): T | undefined;
  set(id: string, value: T): void;
  add(value: T & { id: string }): void;
}

export interface OpenCodeSetupContext {
  mcp?: {
    transform(
      cb: (editor: OpenCodeEditor<OpenCodeMcpConfig>) => void | Promise<void>,
    ): void | Promise<void>;
  };
  skill?: {
    transform(
      cb: (editor: OpenCodeEditor<OpenCodeSkillEntry>) => void | Promise<void>,
    ): void | Promise<void>;
  };
}

export interface OpenCodeLegacyConfig {
  mcp?: Record<string, OpenCodeMcpConfig>;
  [key: string]: unknown;
}

export interface OpenCodeHooks {
  config(cfg: OpenCodeLegacyConfig): Promise<void>;
}

function parseSkillFile(filePath: string, fallbackId: string): OpenCodeSkillEntry {
  const raw = fs.readFileSync(filePath, "utf-8");
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  let name = fallbackId;
  let description = "";
  let content = raw;

  if (match) {
    const yamlBlock = match[1];
    content = match[2];
    for (const line of yamlBlock.split(/\r?\n/)) {
      const kv = line.match(/^(name|description)\s*:\s*(.*)$/);
      if (!kv) continue;
      const key = kv[1];
      let val = kv[2].trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      if (key === "name" && val) {
        name = val;
      } else if (key === "description" && val) {
        description = val;
      }
    }
  }

  return {
    id: fallbackId,
    name,
    description,
    path: filePath,
    content,
  };
}

function loadSkills(): OpenCodeSkillEntry[] {
  if (!fs.existsSync(SKILLS_DIR)) {
    return [];
  }
  const entries = fs
    .readdirSync(SKILLS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .sort((a, b) => a.name.localeCompare(b.name));

  const skills: OpenCodeSkillEntry[] = [];
  for (const entry of entries) {
    const skillPath = path.join(SKILLS_DIR, entry.name, "SKILL.md");
    if (fs.existsSync(skillPath)) {
      skills.push(parseSkillFile(skillPath, entry.name));
    }
  }
  return skills;
}

const plugin = {
  id: "tw-job-hunter",

  async setup(ctx: OpenCodeSetupContext): Promise<void> {
    await ctx.mcp?.transform((editor) => {
      editor.set("tw-job-hunter", {
        type: "local",
        command: ["node", SERVER_PATH],
      });
    });

    await ctx.skill?.transform((editor) => {
      for (const skill of loadSkills()) {
        if (editor.get(skill.id) === undefined) {
          editor.add(skill);
        }
      }
    });
  },

  async server(): Promise<OpenCodeHooks> {
    return {
      async config(cfg: OpenCodeLegacyConfig): Promise<void> {
        cfg.mcp ??= {};
        cfg.mcp["tw-job-hunter"] = {
          type: "local",
          command: ["node", SERVER_PATH],
          enabled: true,
        };
      },
    };
  },
};

export default plugin;
