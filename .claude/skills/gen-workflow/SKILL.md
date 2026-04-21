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

**把成功路径固化为代码** — 确定性的步骤用 JS 锁死，只在需要 LLM 推理时才 `yield*`。好处：稳定、可复现、省 token。

## 执行模型

Workflow 是 `async function*`，运行在 MCP server 的 Node.js 进程中。`yield*` 之外的代码直接在 server 执行（零 token，100% 确定性），`yield*` 的部分交给 LLM。

选择原则：
1. **能用 JS 做的，直接写代码** — `execSync()`、`fs`、`fetch`、数据处理等
2. **需要 Claude 调用特定工具的，用 `ClaudeCodeTools.*`** — 固定调用路径
3. **需要 Claude 自主推理/编排的，用 `Prompt()`** — skill、MCP tool、语义理解任务
4. **需要用户输入的，用 `Prompt("ask user xxx")` 或 `ClaudeCodeTools.AskUserQuestion()`**

## API

### `Prompt(prompt, schema?)`

```ts
const result = yield* Prompt("Analyze this code", z.string());  // 带返回值
yield* Prompt("Stage all changes and commit");                    // 无返回值
```

### `ClaudeCodeTools.*`

`Prompt` 的封装，锁定要调用的工具。传对象（确切参数）或传字符串（自然语言意图）：

```ts
yield* ClaudeCodeTools.Bash({ command: "git diff --name-only" }, z.string());  // 传对象
yield* ClaudeCodeTools.Bash("list changed files", z.string());                 // 传字符串
```

**常用工具：** `AskUserQuestion` / `Bash` / `Agent` / `FileRead` / `FileEdit` / `FileWrite` / `Glob` / `Grep` / `WebFetch` / `WebSearch` / `Mcp`

### `createWorkflowTool({ name, options, workflow })`

Workflow 文件统一 `export default createWorkflowTool(...)`,由调用方决定何时 `.register(server)`:

```ts
export default createWorkflowTool({
  name: "tool-name",
  options: {
    title: "Tool Title",
    description: "What this tool does.",
    constraints_interval: 0,  // 可选：每 N 次返回完整 constraints
    constraints_timeout: 60,  // 可选：超时后重新返回完整 constraints
    inputSchema: {            // 可选：声明 workflow 输入参数
      repo: z.string().describe("repo name"),
    },
  },
  workflow: async function* Workflow({ repo }) { /* ... */ },
});
```

调用方使用：

```ts
import tool from "./my-tool.js";
tool.register(server);
```

### 带输入参数的 workflow

声明 `options.inputSchema` 后,workflow 第一个参数就是类型安全的 input 对象。Agent 首次调用时必须把参数作为 `task_result` 传入（schema 会自动拼到 tool description 里）,无需额外字段:

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

### 避免过度拆分

每次 `yield*` 是一次 tool_use 交互，合并能合并的步骤：

```ts
// Bad — 3 次交互
yield* ClaudeCodeTools.Bash({ command: "git add -A" });
yield* ClaudeCodeTools.Bash({ command: `git commit -m "fix"` });

// Good — 一次 Prompt 或直接 JS
yield* Prompt("stage all changes and commit with message: fix");
execSync('git add -A && git commit -m "fix"');  // Best
```

### 文件数据：传路径而非内容

文件内容不应经过 LLM 中转。LLM 只返回路径，workflow 用 `fs` 直接读取：

```ts
// Bad — 文件内容经 LLM 中转，浪费 token
const content = yield* ClaudeCodeTools.FileRead({ file_path: "config.json" }, z.string());

// Good — LLM 返回路径，workflow 直接读取
const filePath = yield* Prompt("Find the main entry file path", z.string());
const content = fs.readFileSync(filePath, "utf-8");

// Best — 路径已知时直接 JS 处理
const config = JSON.parse(fs.readFileSync("config.json", "utf-8"));
```

### 用户输入

```ts
// Prompt — 灵活，Claude 自行组织提问
const input = yield* Prompt("Ask the user for branch name", z.string());

// AskUserQuestion — 直接提问，更可控
const branch = yield* ClaudeCodeTools.AskUserQuestion("Enter branch name:", z.string());

// 结构化输入
const { name, version } = yield* ClaudeCodeTools.AskUserQuestion(
  "Provide package info:", z.object({ name: z.string(), version: z.string() })
);
```

### 后台执行

```ts
yield* ClaudeCodeTools.Bash({ command: "npm run build", run_in_background: true });
```

### 错误处理

`throw new Error()` 终止 workflow 并报告用户，`return` 正常提前结束：

```ts
async function* Workflow() {
  const status = execSync("git status --porcelain", { encoding: "utf-8" }).trim();
  if (!status) throw new Error("No changes detected.");  // 错误终止
  if (someCondition) return "Nothing to do.";             // 正常结束
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
    // 1. JS 直接执行（零 token）
    // const data = execSync("...", { encoding: "utf-8" });

    // 2. 用户输入
    // const input = yield* ClaudeCodeTools.AskUserQuestion("question", z.string());

    // 3. LLM 推理
    // const result = yield* Prompt("task", z.string());

    // 4. 工具调用
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

1. **Analyze** — break task into atomic steps
2. **Classify** — JS direct / `Prompt()` / `ClaudeCodeTools.*` / `AskUserQuestion()`
3. **Generate** — write workflow code following patterns above,always `export default createWorkflowTool(...)`
4. **Write** — to the user-specified file (one workflow per file); the server entry imports it and calls `.register(server)`
5. **Validate** — every `yield*` must be justified; could it be pure JS instead?
