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
    "plus-number",
    {
      title: "plus number",
      description: `ask user input number, and plus.`,
    },
    async function* Workflow() {
      const variableA = yield* ClaudeCodeTools.AskUserQuestion(
        `please input a number`,
        z.number()
      );

      const variableB = yield* ClaudeCodeTools.AskUserQuestion(
        `please input a number`,
        z.number()
      );

      return variableA + variableB;
    }
  );

  registerWorkflowTool(
    server,
    "sum-number",
    {
      title: "sum number",
      description: `ask user input number, and sum from 1 to input number.`,
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
    "featureflag",
    {
      title: "featureflag",
      description: `use featureflag to control commit changes.`,
    },
    async function* Workflow() {
      const sourceCommit = yield* Prompt(
        `get commit id from user input, if not exist return null`,
        z.string().or(z.null())
      );

      if (!sourceCommit) throw new Error(`commit id is required`);

      const featureKey = yield* Prompt(
        `create an appropriate key by commit ${sourceCommit}, like isEnableFeatureA`,
        z.string()
      );

      const { isConfirm } = yield* ClaudeCodeTools.AskUserQuestion(
        `Executing subsequent commands may cause changes to the workspace code. Please stage all code first.`,
        z.object({
          isConfirm: z.boolean(),
        })
      );

      if (isConfirm) {
        const changedFiles = yield* ClaudeCodeTools.Bash(
          `git list all changed ts/tsx/js/jsx file path in commit ${sourceCommit}`,
          z.array(z.string()).describe(`files list`)
        );

        for (const file of changedFiles) {
          yield* ClaudeCodeTools.Bash({
            command: `git diff ${sourceCommit}^ ${sourceCommit} -- ${file}`,
          });

          yield* Prompt(`use ${featureKey} to control the diff listed in the previous step.
usage:
\`\`\`js
// @ts-ignore
import { ${featureKey} } from 'feature-switch';

if (${featureKey}) {
  newCode;
} else {
  oldCode;
}
const value = ${featureKey} ? newValue : oldValue;
if (${featureKey} && newLogic) {
  newCode;
} else {
  oldCode;
}
const value = ${featureKey} && newLogic ? newValue : oldValue;
\`\`\`
`);
        }
      }
    }
  );
  const transport = new StdioServerTransport();

  await server.connect(transport);
  console.error("McpServer running on stdio...");
}

main().catch(console.error);
