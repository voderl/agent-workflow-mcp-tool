#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { ClaudeCodeTools, registerWorkflowTool, Prompt, z } from "../index.js";

async function main() {
  const server = new McpServer({
    name: "agent-workflow",
    version: "0.0.1",
  });

  registerWorkflowTool(
    server,
    "sum-number",
    {
      title: "sum number",
      description: `sum number workflow control`,
    },
    async function* Workflow() {
      const count = yield* ClaudeCodeTools.AskUserQuestion(
        `please input a number`,
        z.number()
      );

      let sum = 0;
      for (let i = 1; i <= count; i++) {
        sum = yield* Prompt(`calculate ${sum} + ${i}`, z.number());
      }
      return sum;
    }
  );

  registerWorkflowTool(
    server,
    "auto-commit",
    {
      title: "Auto Commit",
      description:
        "Automatically generates a commit message and commits current changes.",
    },
    async function* Workflow() {
      // Step 1: Get the list of changed files
      const filesChangeList = yield* Prompt(
        "Get the list of currently changed files",
        z.array(z.string())
      );

      if (filesChangeList.length === 0) {
        return "No code changes detected.";
      }

      // Step 2: Generate a structured commit message
      const commitMessage = yield* Prompt(
        `Generate a commit message based on the current changes. The format must follow:
(fix|feat|chore): a concise single-line summary

Detailed description of changes in multiple lines if necessary.`,
        z.string()
      );

      // Step 3: User confirmation
      const { is_confirm } = yield* ClaudeCodeTools.AskUserQuestion(
        `The suggested commit message is: \n\n${commitMessage}\n\nDo you want to proceed with the commit?`,
        z.object({
          is_confirm: z.boolean(),
        })
      );

      if (!is_confirm) return "Commit cancelled by user.";

      // Step 4: Execute the commit
      yield* Prompt(
        `Commit the current changes with the following message: ${commitMessage}`
      );

      return "Changes committed successfully!";
    }
  );
  const transport = new StdioServerTransport();

  await server.connect(transport);
  console.error("McpServer running on stdio...");
}

main().catch(console.error);
