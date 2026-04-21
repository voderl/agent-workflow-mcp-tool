# agent-workflow-mcp-tool
Code controlled agent workflow. Agent lies, code not.

* typescript support
* async await support
* throw catch support
* sub agent support
* works well with claude & deepseek-v3.2 & kimi-k2

## usage
```bash
npm install agent-workflow-mcp-tool
```

```js
import { registerWorkflowTool, Prompt, ClaudeCodeTools, z } from 'agent-workflow-mcp-tool';
```

simple demo to sum number with claude code:
```js
const server = new McpServer({
  name: "agent-workflow",
  version: "0.0.1",
});

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
```
```
Ask: use mcp "agent-workflow" tool "sum-number" directly
```

`registerWorkflowTool` also supports constraint throttling options:

- `constraints_interval`: return full `<constraints>` every N calls. The first processing response still returns full constraints.
- `constraints_timeout`: return full `<constraints>` again when more than N seconds have passed since the last full constraints response. Default is `60`.

another complex demo to auto commit:
```js
registerWorkflowTool(
    server,
    "auto-commit",
    {
      title: "Auto Commit",
      description: "Automatically generates a commit message and commits current changes.",
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
      yield* Prompt(`Commit the current changes with the following message: ${commitMessage}`);
      
      return "Changes committed successfully!";
    }
);
```
