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

import { formatError, formatToJsonSchema, formatToString } from "./utils.js";

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
        prompt: `<workflow_status>done</workflow_status>
You have successfully completed the workflow.${
          result !== null && result !== undefined
            ? `
<workflow_result>
${formatToString(result)}
</workflow_result>`
            : ``
        }`,
      };
    } catch (e: any) {
      return {
        prompt: `<workflow_status>error</workflow_status>
An error occurred with the MCP server:
<error>
${formatError(e)}
</error>
The workflow cannot be completed, you MUST inform the user that current mcp tool execution has failed.`,
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
    prompt: `<workflow_status>processing</workflow_status>
<task>
${prompt}
</task>
${
  schema
    ? `<task_result_json_schema>
${JSON.stringify(formatToJsonSchema(schema))}
</task_result_json_schema>
<critical_reminders>
The workflow is processing, you MUST complete current task exactly as requested to continue workflow, NEVER skip task.
ONLY if task failed or cannot get task result, you can recall current mcp tool with custom error message as "error", NEVER pass "error" to complete the workflow.
If task completed, you MUST recall current mcp tool with task result as "input".
NEVER end your responses with workflow status processing.
</critical_reminders>`
    : `<critical_reminders>
The workflow is processing, you MUST complete current task exactly as requested to continue workflow, NEVER skip task.
ONLY if task failed, you can recall current mcp tool with custom error message as "error", NEVER pass "error" to complete the workflow.
If task completed, you MUST recall current mcp tool with no props.
NEVER end your responses with workflow status processing.
</critical_reminders>`
}`,
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
