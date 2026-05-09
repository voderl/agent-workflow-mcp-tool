import { ClaudeCodeTools, createWorkflowTool, Prompt, z } from "../../../index.js";

export default createWorkflowTool({
  name: "sum-number",
  options: {
    title: "sum number",
    description: "sum number workflow control",
  },
  workflow: async function* Workflow() {
    const count = yield* ClaudeCodeTools.AskUserQuestion(
      `please input a number`,
      z.number(),
    );

    let sum = 0;
    for (let i = 1; i <= count; i++) {
      sum = yield* Prompt(`calculate ${sum} + ${i}`, z.number());
    }

    const str = yield* ClaudeCodeTools.Bash(
      {
        command: 'sleep 30 && echo "hello"',
        run_in_background: true,
      },
      z.string(),
    );
    return str + sum;
  },
});
