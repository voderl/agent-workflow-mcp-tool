import type {
  AgentInput,
  AskUserQuestionInput,
  BashInput,
  ExitPlanModeInput,
  FileEditInput,
  FileReadInput,
  FileWriteInput,
  GlobInput,
  GrepInput,
  KillShellInput,
  ListMcpResourcesInput,
  McpInput,
  NotebookEditInput,
  ReadMcpResourceInput,
  TaskOutputInput,
  TodoWriteInput,
  WebFetchInput,
  WebSearchInput,
} from "./claude-code-tools.js";
import z from "zod";
import type { ZodType } from "zod";

import { formatError, formatToString } from "./utils.js";

export const completeSymbol = Symbol("Completed");

export type WorkflowGenerator = AsyncGenerator<
  WorkflowState,
  WorkflowState,
  any
>;

export function createWorkflow(
  workflow: () => AsyncGenerator<WorkflowState, any, any>
) {
  return async function* Workflow(): WorkflowGenerator {
    try {
      const result = yield* workflow();
      return {
        prompt: `Status: Done.
You have successfully completed the workflow.${
          result !== null && result !== undefined
            ? `
Return value:
\`\`\`
${formatToString(result)}
\`\`\`
`
            : ``
        }
`,
      };
    } catch (e: any) {
      return {
        prompt: `Status: Error.
An error occurred with the MCP server:
\`\`\`
${formatError(e)}
\`\`\`
The workflow cannot be completed, you must inform the user that current mcp tool execution has failed.
`,
      };
    }
  };
}

export type WorkflowState = {
  prompt: string;
  schema?: ZodType;
};

export function Prompt<TSchema extends ZodType>(
  prompt: string,
  schema: TSchema
): Generator<WorkflowState, z.infer<TSchema>>;
export function Prompt(
  prompt: string
): Generator<WorkflowState, undefined, undefined>;
export function* Prompt(
  prompt: string,
  schema?: ZodType
): Generator<WorkflowState, any, any> {
  const result = yield {
    prompt: `Status: Processing.
Workflow is not completed, you should complete the following task to continue:
\`\`\`md
${prompt}
\`\`\`
${
  schema
    ? `The task result will be used as $variable, $variable must follow the JSON schema format below:
\`\`\`json
${JSON.stringify(z.toJSONSchema(schema))}
\`\`\`

If task failed or cannot get $variable, you should recall current mcp tool with custom error message as "error".
If task completed, you should recall current mcp tool with $varible as "input".`
    : `If task failed, you should recall current mcp tool with custom error message as "error".
If task completed, you should recall current mcp tool with no props.`
}
`,
    schema: schema!,
  };
  return result;
}

type ToolProps<T> = string | Partial<T>;

const createToolFunction = <T>(toolName: string) => {
  function ToolFunction<TSchema extends ZodType>(
    props: ToolProps<T>,
    schema: TSchema
  ): Generator<WorkflowState, z.infer<TSchema>>;
  function ToolFunction(
    props: ToolProps<T>
  ): Generator<WorkflowState, undefined, undefined>;
  function ToolFunction(props: ToolProps<T>, schema?: ZodType) {
    return Prompt(
      typeof props === "string"
        ? `use *${toolName}* tool to achieve \`${props}\``
        : `use *${toolName}* tool with props \`${JSON.stringify(props)}\``,
      schema!
    );
  }
  return ToolFunction;
};

export const ClaudeCodeTools = {
  Agent: createToolFunction<AgentInput>("Agent"),
  AskUserQuestion: createToolFunction<AskUserQuestionInput>("AskUserQuestion"),
  Bash: createToolFunction<BashInput>("Bash"),
  ExitPlanMode: createToolFunction<ExitPlanModeInput>("ExitPlanMode"),
  FileEdit: createToolFunction<FileEditInput>("FileEdit"),
  FileRead: createToolFunction<FileReadInput>("FileRead"),
  FileWrite: createToolFunction<FileWriteInput>("FileWrite"),
  Glob: createToolFunction<GlobInput>("Glob"),
  Grep: createToolFunction<GrepInput>("Grep"),
  KillShell: createToolFunction<KillShellInput>("KillShell"),
  ListMcpResources:
    createToolFunction<ListMcpResourcesInput>("ListMcpResources"),
  Mcp: createToolFunction<McpInput>("Mcp"),
  NotebookEdit: createToolFunction<NotebookEditInput>("NotebookEdit"),
  ReadMcpResource: createToolFunction<ReadMcpResourceInput>("ReadMcpResource"),
  TaskOutput: createToolFunction<TaskOutputInput>("TaskOutput"),
  TodoWrite: createToolFunction<TodoWriteInput>("TodoWrite"),
  WebFetch: createToolFunction<WebFetchInput>("WebFetch"),
  WebSearch: createToolFunction<WebSearchInput>("WebSearch"),
};
