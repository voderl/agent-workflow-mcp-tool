import { createWorkflowTool, Prompt, z } from "../../../index.js";

export default createWorkflowTool({
  name: "greet-user",
  options: {
    title: "Greet User",
    description: "Greet a user by name with a custom greeting.",
    inputSchema: {
      name: z.string().describe("The user's name"),
      greeting: z.string().describe("The greeting phrase (e.g. 'Hello')"),
    },
  },
  workflow: async function* Workflow({ name, greeting }) {
    yield* Prompt(`Say "${greeting}, ${name}!" to the user`);
    return `Greeted ${name}`;
  },
});
