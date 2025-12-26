import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  createWorkflow,
  type WorkflowGenerator,
  type WorkflowState,
} from "./create-workflow.js";
import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import z from "zod";
import type { ZodType } from "zod";
import { wrapText, formatError } from "./utils.js";

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
      schema?: ZodType;
    };
  } = {};

  const Workflow = createWorkflow(workflow);

  server.registerTool(
    name,
    {
      ...options,
      inputSchema: {
        input: z.any().optional().describe(`First call with no props.`),
        error: z.string().optional().describe(`First call with no props.`),
      },
    },
    async (args: any, extra) => {
      const currentSessionId = extra.sessionId || "stdio";

      if (!(currentSessionId in pools)) {
        // create workflow
        const generator = Workflow();

        pools[currentSessionId] = {
          generator,
        };

        // 首次调用传 error 忽略
        if ("error" in args) delete args["error"];
      }

      const { generator, schema } =
        pools[currentSessionId as keyof typeof pools]!;

      if ("error" in args && args.error) {
        const error = new Error(args.error);
        console.error(error);
        const { value, done } = await generator.throw(error);
        if (!done) {
          pools[currentSessionId] = {
            generator: generator,
            schema: value.schema!,
          };

          return {
            content: wrapText(value.prompt),
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
          pools[currentSessionId] = {
            generator,
            schema: value.schema!,
          };
          return {
            content: wrapText(value.prompt),
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
