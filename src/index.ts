import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  createWorkflow,
  type WorkflowGenerator,
  type WorkflowState,
} from "./create-workflow.js";
import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import z from "zod";
import type { ZodRawShape, ZodType } from "zod";
import { formatToJsonSchema, wrapText, formatError } from "./utils.js";
export { ClaudeCodeTools, Prompt } from "./create-workflow.js";
export { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
export { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

export { z };

function generateTaskId(seq: number): string {
  return `task_${seq}`;
}

export type WorkflowToolOptions = {
  title?: string;
  description?: string;
  annotations?: ToolAnnotations;
  _meta?: Record<string, unknown>;
  constraints_interval?: number;
  constraints_timeout?: number;
};

export type CreateWorkflowToolArgs<
  TInputSchema extends Record<string, ZodType> | undefined = undefined,
> = {
  name: string;
  options: WorkflowToolOptions & { inputSchema?: TInputSchema };
  workflow: (
    input: TInputSchema extends Record<string, ZodType>
      ? { [K in keyof TInputSchema]: z.infer<TInputSchema[K]> }
      : void,
  ) => AsyncGenerator<WorkflowState, any, any>;
};

export type WorkflowTool = {
  register(server: McpServer): void;
};

export function createWorkflowTool<
  TInputSchema extends Record<string, ZodType> | undefined = undefined,
>({
  name,
  options,
  workflow,
}: CreateWorkflowToolArgs<TInputSchema>): WorkflowTool {
  const constraintsInterval = options.constraints_interval ?? 0;
  const constraintsTimeoutMs = (options.constraints_timeout ?? 60) * 1000;

  const pools: {
    [key: string]: {
      generator: WorkflowGenerator;
      schema?: ZodType;
      taskId?: string;
      callCount: number;
      lastConstraintsAt: number | undefined;
      seq: number;
    };
  } = {};

  const Workflow = createWorkflow(workflow);

  const STALE_TASK_MESSAGE = wrapText(
    `The provided task_id does not match the current task. This task is stale. Please complete the current task. If the workflow has encountered issues, you can pass an "error" to abort, then re-call this tool with no props to restart the workflow.`,
  );

  const fullConstraintsText = `<constraints>
1. Complete the current task as specified; If current task running in background, end responses to wait until it completed. NEVER skip task.
2. BRANCHING:
   - If <task_result_schema> is present and task completed: reuse current tool with task_id + task_result (matching schema).
   - If no <task_result_schema> and task completed: reuse current tool with task_id only.
   - If task failed OR cannot get result: reuse current tool with task_id + error message.
3. NEVER end responses while workflow status is "processing" and no active background tasks, MUST reuse current tool to continue.
</constraints>`;

  const getConstraintsText = (
    callCount: number,
    lastConstraintsAt?: number,
  ) => {
    const now = Date.now();
    const shouldShowByInterval =
      constraintsInterval === 1 ||
      callCount === 0 ||
      (constraintsInterval > 1 && callCount % constraintsInterval === 0);
    const shouldShowByTimeout =
      constraintsTimeoutMs > 0 &&
      lastConstraintsAt !== undefined &&
      now - lastConstraintsAt >= constraintsTimeoutMs;
    const shouldShowFull = shouldShowByInterval || shouldShowByTimeout;

    if (shouldShowFull) {
      return {
        text: fullConstraintsText,
        lastConstraintsAt: now,
      };
    }

    // Not showing full constraints, show reference hint
    return {
      text: `<constraints>Refer to the constraints returned previously.</constraints>`,
      lastConstraintsAt,
    };
  };

  const wrapPrompt = (
    prompt: string,
    meta: {
      workflow_status: string;
      task_id?: string;
      callCount: number;
      lastConstraintsAt: number | undefined;
    },
  ) => {
    let header = `<workflow_status>${meta.workflow_status}</workflow_status>`;
    const constraintsResult =
      meta.workflow_status === "processing"
        ? getConstraintsText(meta.callCount, meta.lastConstraintsAt)
        : undefined;
    const constraintsText = constraintsResult
      ? `\n${constraintsResult.text}`
      : "";
    // Inject task_id as attribute into the first <task> tag if present
    const processedPrompt = meta.task_id
      ? prompt.replace(/^<task>/, `<task id="${meta.task_id}">`)
      : prompt;
    return {
      prompt: `${header}\n${processedPrompt}${constraintsText}`,
      lastConstraintsAt:
        constraintsResult?.lastConstraintsAt ?? meta.lastConstraintsAt,
    };
  };

  const customInputSchema = options.inputSchema;
  const inputValidator = customInputSchema
    ? z.object(customInputSchema as Record<string, ZodType>)
    : undefined;
  const inputJsonSchema = inputValidator
    ? JSON.stringify(formatToJsonSchema(inputValidator))
    : undefined;

  const descriptionWithInput = inputJsonSchema
    ? `${options.description ?? ""}

On the first call, pass the workflow input as "task_result" matching this schema:
<input_schema>
${inputJsonSchema}
</input_schema>`
    : options.description;

  const { inputSchema: _ignoredInputSchema, ...restOptions } = options;

  const register = (server: McpServer) => {
    server.registerTool(
      name,
      {
        ...restOptions,
        ...(descriptionWithInput !== undefined
          ? { description: descriptionWithInput }
          : {}),
        inputSchema: {
          task_id: z
            .string()
            .optional()
            .describe(
              `The task_id from the previous step. Pass only when current task completed and no active background tasks.`,
            ),
          task_result: z
            .any()
            .optional()
            .describe(
              inputJsonSchema
                ? `On the first call: the workflow input object matching the schema in the tool description. On subsequent calls: the result of the previous task.`
                : `The task_result from the previous step.`,
            ),
          error: z.string().optional().describe(`error message.`),
        },
      },
      async (args: any, extra) => {
        const currentSessionId = extra.sessionId || "stdio";

        if (!(currentSessionId in pools)) {
          // 首次调用：用 task_result 作为 workflow input 通道
          let workflowInput: any = undefined;
          if (inputValidator) {
            const parseInput = (raw: unknown) => inputValidator.safeParse(raw);
            let parsed = parseInput(args.task_result);
            if (!parsed.success && typeof args.task_result === "string") {
              try {
                parsed = parseInput(JSON.parse(args.task_result));
              } catch {
                // ignore
              }
            }
            if (!parsed.success) {
              return {
                content:
                  wrapText(`Invalid workflow input, MUST reuse the current tool passing the input as "task_result" matching the schema below:
<validate_error>
${formatError(parsed.error)}
</validate_error>
<input_schema>
${inputJsonSchema}
</input_schema>`),
              };
            }
            workflowInput = parsed.data;
          }

          // create workflow
          const generator = Workflow(workflowInput);

          pools[currentSessionId] = {
            generator,
            callCount: 0,
            lastConstraintsAt: undefined,
            seq: 0,
          };

          // 首次调用传 error 忽略
          if ("error" in args) delete args["error"];
        }

        const pool = pools[currentSessionId as keyof typeof pools]!;
        const { generator, schema } = pool;
        const currentCallCount = pool.callCount;
        pool.callCount++;

        // 校验 task_id
        if (pool.taskId && args.task_id !== pool.taskId) {
          return {
            content: STALE_TASK_MESSAGE,
          };
        }

        if ("error" in args && args.error) {
          const error = new Error(args.error);
          console.error(error);
          const { value, done } = await generator.throw(error);
          if (!done) {
            const nextSeq = pool.seq + 1;
            const newTaskId = generateTaskId(nextSeq);
            const wrappedPrompt = wrapPrompt(value.prompt, {
              workflow_status: value.status || "processing",
              task_id: newTaskId,
              callCount: currentCallCount,
              lastConstraintsAt: pool.lastConstraintsAt,
            });
            pools[currentSessionId] = {
              generator: generator,
              schema: value.schema!,
              taskId: newTaskId,
              callCount: pool.callCount,
              lastConstraintsAt: wrappedPrompt.lastConstraintsAt,
              seq: nextSeq,
            };

            return {
              content: wrapText(wrappedPrompt.prompt),
            };
          } else {
            delete pools[currentSessionId];
          }

          const wrappedPrompt = wrapPrompt(value.prompt, {
            workflow_status: value.status || "done",
            callCount: currentCallCount,
            lastConstraintsAt: pool.lastConstraintsAt,
          });
          return {
            content: wrapText(wrappedPrompt.prompt),
          };
        }

        const execGenerator = async (props?: any) => {
          const { value, done } = await generator.next(props);

          if (!done) {
            const nextSeq = pool.seq + 1;
            const newTaskId = generateTaskId(nextSeq);
            const wrappedPrompt = wrapPrompt(value.prompt, {
              workflow_status: value.status || "processing",
              task_id: newTaskId,
              callCount: currentCallCount,
              lastConstraintsAt: pool.lastConstraintsAt,
            });
            pools[currentSessionId] = {
              generator,
              schema: value.schema!,
              taskId: newTaskId,
              callCount: pool.callCount,
              lastConstraintsAt: wrappedPrompt.lastConstraintsAt,
              seq: nextSeq,
            };
            return {
              content: wrapText(wrappedPrompt.prompt),
            };
          } else {
            delete pools[currentSessionId];
          }

          const wrappedPrompt = wrapPrompt(value.prompt, {
            workflow_status: value.status || "done",
            callCount: currentCallCount,
            lastConstraintsAt: pool.lastConstraintsAt,
          });
          return {
            content: wrapText(wrappedPrompt.prompt),
          };
        };

        if (schema) {
          const validator = async (input: any) => {
            try {
              const data = schema.parse(input);
              try {
                return await execGenerator(data);
              } catch (e) {
                return {
                  content: wrapText(formatError(e)),
                };
              }
            } catch (e: any) {
              if (typeof input === "string") {
                try {
                  const parsedInput = JSON.parse(input);
                  return await validator(parsedInput);
                } catch (e: any) {
                  // do nothing
                }
              }
              return {
                content:
                  wrapText(`Invalid "task_result" format, MUST reuse the current tool using the following format as "task_result":
<validate_error>
${formatError(e)}
</validate_error>
<task_result_schema>
${JSON.stringify(formatToJsonSchema(schema))}
</task_result_schema>`),
              };
            }
          };

          return await validator(args.task_result);
        }

        return await execGenerator();
      },
    );
  };

  return { register };
}

export function registerWorkflowTool<
  TInputSchema extends Record<string, ZodType> | undefined = undefined,
>(
  server: McpServer,
  name: string,
  options: WorkflowToolOptions & { inputSchema?: TInputSchema },
  workflow: CreateWorkflowToolArgs<TInputSchema>["workflow"],
): WorkflowTool {
  const tool = createWorkflowTool<TInputSchema>({ name, options, workflow });
  tool.register(server);
  return tool;
}
