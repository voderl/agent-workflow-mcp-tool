import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  createWorkflow,
  type WorkflowGenerator,
  type WorkflowState,
} from "./create-workflow.js";
import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import z from "zod";
import type { ZodType } from "zod";
import {
  createMockProgressGenerator,
  wrapProgress,
  wrapText,
  formatError,
} from "./utils.js";

export { ClaudeCodeTools, Prompt } from "./create-workflow.js";

export { z };

export function registerWorkflowTool(
  server: McpServer,
  name: string,
  options: {
    title?: string;
    description?: string;
    annotations?: ToolAnnotations;
    _meta?: Record<string, unknown>;
  },
  workflow: () => AsyncGenerator<WorkflowState, any, any>
) {
  const pools: {
    [key: string]: {
      generator: WorkflowGenerator;
      progresser: Generator<string>;
      schema?: ZodType;
    };
  } = {};

  const Workflow = createWorkflow(workflow);

  server.registerTool(
    name,
    {
      ...options,
      inputSchema: {
        input: z
          .any()
          .optional()
          .describe(`If you don't know what to send, don't send anything.`),
        error: z
          .string()
          .optional()
          .describe(`If you don't know what to send, don't send anything.`),
      },
    },
    async (args: any, extra) => {
      const currentSessionId = extra.sessionId || "stdio";

      if (!(currentSessionId in pools)) {
        // create workflow
        const generator = Workflow();
        const progresser = createMockProgressGenerator();

        pools[currentSessionId] = {
          generator,
          progresser,
        };
      }

      const { generator, progresser, schema } =
        pools[currentSessionId as keyof typeof pools]!;

      if ("error" in args) {
        const error = new Error(args.error);
        console.error(error);
        const { value, done } = await generator.throw(error);
        if (!done) {
          const { value: progress } = progresser.next();
          pools[currentSessionId] = {
            generator: generator,
            schema: value.schema!,
            progresser,
          };

          return {
            content: wrapText(wrapProgress(value.prompt, progress)),
          };
        } else {
          delete pools[currentSessionId];
        }

        return {
          content: wrapText(value.prompt),
        };
      }

      const execGenerator = async (props?: any) => {
        const { value, done } = await generator.next(props);

        if (!done) {
          const { value: progress } = progresser.next();
          pools[currentSessionId] = {
            generator,
            schema: value.schema!,
            progresser,
          };
          return {
            content: wrapText(wrapProgress(value.prompt, progress)),
          };
        } else {
          delete pools[currentSessionId];
        }

        return {
          content: wrapText(value.prompt),
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
                wrapText(`Invalid "input" format, you should recall the current tool using the following format as "input": 
${formatError(e)}`),
            };
          }
        };

        return await validator(args.input);
      }

      return await execGenerator();
    }
  );
}
