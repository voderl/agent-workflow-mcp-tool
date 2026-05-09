#!/usr/bin/env node
import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { McpServer, StdioServerTransport, logger } from "../index.js";

function parseLogFile(argv: string[]): string | undefined {
  const eqIdx = argv.findIndex((a) => a.startsWith("--log-file="));
  if (eqIdx !== -1) return argv[eqIdx]!.slice("--log-file=".length);
  const flagIdx = argv.indexOf("--log-file");
  if (flagIdx !== -1 && flagIdx + 1 < argv.length) return argv[flagIdx + 1];
  return undefined;
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const workflowsDir = join(__dirname, "workflows");

async function registerAllWorkflows(server: McpServer) {
  const entries = readdirSync(workflowsDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const modulePath = join(workflowsDir, entry.name, "index.js");
    let mod: any;
    try {
      mod = await import(pathToFileURL(modulePath).href);
    } catch (err) {
      console.error(`[workflows] failed to import "${entry.name}":`, err);
      continue;
    }
    if (typeof mod.default?.register !== "function") {
      console.error(
        `[workflows] skipping "${entry.name}": module does not export a default with a register() method`,
      );
      continue;
    }
    mod.default.register(server);
  }
}

async function main() {
  const logFile = parseLogFile(process.argv.slice(2));

  if (logFile) {
    logger.enable({ logFile, mode: "overwrite" });
  }

  const server = new McpServer({
    name: "agent-workflow",
    version: "0.0.1",
  });

  await registerAllWorkflows(server);

  const transport = new StdioServerTransport();

  await server.connect(transport);
  console.error("McpServer running on stdio...");
}

main().catch(console.error);
