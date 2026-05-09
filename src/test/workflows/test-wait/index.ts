import { ClaudeCodeTools, createWorkflowTool, z } from "../../../index.js";

export default createWorkflowTool({
  name: "test-wait",
  options: {
    title: "test-wait",
    description: "test-wait workflow control",
  },
  workflow: async function* Workflow() {
    yield* ClaudeCodeTools.Bash(
      {
        command: 'sleep 180 && echo "hello"',
        run_in_background: true,
      },
      z.string(),
    );
  },
});
