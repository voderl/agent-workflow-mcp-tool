---
name: gen-workflow
description: >-
  Generate an agent-workflow-mcp-tool workflow. Converts a task description into
  a TypeScript workflow that codifies the successful execution path into deterministic code,
  ensuring stable and reproducible agent behavior.
  Use when the user asks to "write a workflow", "create a workflow", "generate workflow",
  "add a new tool", or describes a multi-step automated task they want to register.
user-invocable: true
---

# Generate agent-workflow-mcp-tool Workflow

You are generating a workflow for `agent-workflow-mcp-tool` — a library that lets you control Claude Code's execution flow via TypeScript generators.

## Core Principle

**Lock the success path into code.** Deterministic steps run as plain JS; only `yield*` when LLM reasoning is required. Result: stable, reproducible, token-efficient.

## Execution Model

A workflow is an `async function*` running inside the MCP server's Node process. Code outside `yield*` runs directly on the server (zero tokens, fully deterministic); `yield*` hands control to the LLM.

Decision rules:
1. **Pure logic** — write JS (`execSync`, `fs`, `fetch`, data shaping).
2. **Fixed tool call by Claude** — use `ClaudeCodeTools.*`.
3. **LLM reasoning / orchestration** — use `Prompt()` (skills, MCP tools, semantic tasks).
4. **User input** — `Prompt("ask user xxx")` or `ClaudeCodeTools.AskUserQuestion()`.
5. **External MCP server with known schema** — call directly via `connectMcp()`; do not route through Claude.
6. **Debug / audit** — write structured logs via `logger`; no tokens, no impact on tool output.

## API

### `Prompt(prompt, schema?)`

```ts
const result = yield* Prompt("Analyze this code", z.string());  // with return value
yield* Prompt("Stage all changes and commit");                    // no return value
```

### `ClaudeCodeTools.*`

A `Prompt` wrapper that pins the tool. Pass an object (exact args) or a string (intent):

```ts
yield* ClaudeCodeTools.Bash({ command: "git diff --name-only" }, z.string());  // object
yield* ClaudeCodeTools.Bash("list changed files", z.string());                  // string
```

**Common tools:** `AskUserQuestion` / `Bash` / `Agent` / `FileRead` / `FileEdit` / `FileWrite` / `Glob` / `Grep` / `WebFetch` / `WebSearch` / `Mcp`

### `createWorkflowTool({ name, options, workflow })`

Each workflow file does `export default createWorkflowTool(...)`; the caller decides when to `.register(server)`:

```ts
export default createWorkflowTool({
  name: "tool-name",
  options: {
    title: "Tool Title",
    description: "What this tool does.",
    constraints_interval: 0,  // optional: re-emit full constraints every N calls
    constraints_timeout: 60,  // optional: re-emit full constraints after timeout
    inputSchema: {            // optional: declare workflow input args
      repo: z.string().describe("repo name"),
    },
  },
  workflow: async function* Workflow({ repo }) { /* ... */ },
});
```

Caller side:

```ts
import tool from "./my-tool.js";
tool.register(server);
```

### Workflows with input args

Declare `options.inputSchema` and the workflow's first arg becomes a typed input object. The agent's first call must supply the args via `task_result` (the schema is auto-appended to the tool description) — no extra fields needed:

```ts
export default createWorkflowTool({
  name: "greet",
  options: {
    description: "Greet a user.",
    inputSchema: {
      name: z.string(),
      greeting: z.string(),
    },
  },
  workflow: async function* ({ name, greeting }) {
    yield* Prompt(`Say "${greeting}, ${name}!" to the user`);
  },
});
```

## Key Patterns

### Avoid over-splitting

Each `yield*` is a tool_use round-trip. Merge whatever can be merged:

```ts
// Bad — 2 round-trips
yield* ClaudeCodeTools.Bash({ command: "git add -A" });
yield* ClaudeCodeTools.Bash({ command: `git commit -m "fix"` });

// Good — single Prompt
yield* Prompt("stage all changes and commit with message: fix");

// Best — pure JS
execSync('git add -A && git commit -m "fix"');
```

### File data: pass paths, not contents

File contents should not flow through the LLM. Have the LLM return a path; read it with `fs`:

```ts
// Bad — file content round-trips through the LLM
const content = yield* ClaudeCodeTools.FileRead({ file_path: "config.json" }, z.string());

// Good — LLM returns the path, workflow reads directly
const filePath = yield* Prompt("Find the main entry file path", z.string());
const content = fs.readFileSync(filePath, "utf-8");

// Best — path is known, skip the LLM
const config = JSON.parse(fs.readFileSync("config.json", "utf-8"));
```

### User input

```ts
// Prompt — flexible, Claude phrases the question
const input = yield* Prompt("Ask the user for branch name", z.string());

// AskUserQuestion — direct, more controllable
const branch = yield* ClaudeCodeTools.AskUserQuestion("Enter branch name:", z.string());

// Structured input
const { name, version } = yield* ClaudeCodeTools.AskUserQuestion(
  "Provide package info:", z.object({ name: z.string(), version: z.string() })
);
```

### Background execution

```ts
yield* ClaudeCodeTools.Bash({ command: "npm run build", run_in_background: true });
```

### Calling MCP servers directly (`connectMcp`)

**Precondition: only when the target tool's response shape is known.** The code must be able to deterministically parse `result.content`. Otherwise let Claude make the call (via `ClaudeCodeTools.Mcp` or `Prompt`) and have the LLM handle unstructured output.

When the precondition holds, **do not** route through Claude (wastes tokens, non-deterministic). Use `connectMcp` and consume the result inside the workflow process:

```ts
import { connectMcp } from "agent-workflow-mcp-tool";

const mcp = connectMcp({
  command: "npx",
  args: ["-y", "some-mcp-server"],
});

// Only parse this way when the tool is documented to return JSON shaped { items: [...] }
const result = await mcp.send({
  name: "some-tool",
  arguments: { foo: "bar" },
});
const { items } = JSON.parse(result.content[0].text);
await mcp.close();
```

Good fit: your own MCP servers, internal APIs with stable schemas — code-consumable output.
Bad fit: external MCP servers returning natural-language summaries or unstable shapes.

### Logging (`logger`)

`logger` is a module-level singleton, no-op by default. Call `logger.enable({ logFile })` to start writing. Zero tokens, no effect on tool output — debug/audit only:

```ts
import { logger } from "agent-workflow-mcp-tool";

// Enable once at server startup
logger.enable({ logFile: "workflow.log" });                   // relative to cwd, append
logger.enable({ logFile: "/tmp/wf.log", mode: "overwrite" });  // absolute path, overwrite

// Use anywhere inside a workflow
logger.info({ step: "start", input });
logger.warning({ slowTask: taskId });
logger.error(new Error("boom"));
```

One NDJSON record per line: `{"ts":"...","level":"info","data":{...}}`. `data` keeps its original shape — no double stringify.

### Error handling

`throw new Error()` aborts the workflow and surfaces the message. `return` ends it normally:

```ts
async function* Workflow() {
  const status = execSync("git status --porcelain", { encoding: "utf-8" }).trim();
  if (!status) throw new Error("No changes detected.");  // abort
  if (someCondition) return "Nothing to do.";             // graceful exit
}
```

## Template

```ts
import { createWorkflowTool, Prompt, ClaudeCodeTools, z } from 'agent-workflow-mcp-tool';
import { execSync } from 'child_process';
import fs from 'fs';

export default createWorkflowTool({
  name: "tool-name",
  options: {
    title: "Tool Title",
    description: "What this tool does.",
  },
  workflow: async function* Workflow() {
    // 1. Pure JS (zero tokens)
    // const data = execSync("...", { encoding: "utf-8" });

    // 2. User input
    // const input = yield* ClaudeCodeTools.AskUserQuestion("question", z.string());

    // 3. LLM reasoning
    // const result = yield* Prompt("task", z.string());

    // 4. Tool call
    // yield* ClaudeCodeTools.Bash({ command: "..." });

    return "done";
  },
});
```

## Example: Auto-Commit

```ts
export default createWorkflowTool({
  name: "auto-commit",
  options: {
    title: "Auto Commit",
    description: "Auto-generate commit message and commit.",
  },
  workflow: async function* Workflow() {
    const diff = execSync("git diff --name-only", { encoding: "utf-8" }).trim();
    const staged = execSync("git diff --cached --name-only", { encoding: "utf-8" }).trim();
    const changes = [...new Set([...diff.split("\n"), ...staged.split("\n")])].filter(Boolean);
    if (changes.length === 0) return "No changes detected.";

    const msg = yield* Prompt(
      `Generate a commit message for current changes: (fix|feat|chore): summary`,
      z.string()
    );

    const { ok } = yield* ClaudeCodeTools.AskUserQuestion(
      `Commit message:\n\n${msg}\n\nProceed?`, z.object({ ok: z.boolean() })
    );
    if (!ok) return "Cancelled.";

    yield* Prompt(`Commit current changes with message: ${msg}`);
    return "Committed!";
  },
});
```

## Instructions

1. **Analyze** — break the task into atomic steps.
2. **Classify** — JS direct / `Prompt()` / `ClaudeCodeTools.*` / `AskUserQuestion()`.
3. **Generate** — follow the patterns above; always `export default createWorkflowTool(...)`.
4. **Write** — to the user-specified file (one workflow per file); the server entry imports it and calls `.register(server)`.
5. **Validate** — every `yield*` must be justified. Could it be pure JS instead?
