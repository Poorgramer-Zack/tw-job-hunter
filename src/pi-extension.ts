import path from "node:path";

export interface PiMcpServerConfig {
  command: string;
  args: string[];
}

export interface PiExtensionAPI {
  registerMcpServer(name: string, config: PiMcpServerConfig): void;
}

export default function registerTwJobHunter(pi: PiExtensionAPI): void {
  const serverPath = path.resolve(import.meta.dirname, "..", "dist", "server.js");
  pi.registerMcpServer("tw-job-hunter", {
    command: "node",
    args: [serverPath],
  });
}
