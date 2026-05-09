import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
  StdioClientTransport,
  type StdioServerParameters,
} from "@modelcontextprotocol/sdk/client/stdio.js";
import type {
  CallToolRequest,
  CallToolResult,
} from "@modelcontextprotocol/sdk/types.js";

export type ConnectMcpOptions = StdioServerParameters & {
  /**
   * Name to advertise as the client. Defaults to "agent-workflow-mcp-client".
   */
  clientName?: string;
  /**
   * Version to advertise as the client. Defaults to "0.0.1".
   */
  clientVersion?: string;
};

export type McpSendParams = CallToolRequest["params"];

export type McpInstance = {
  /**
   * The underlying MCP client. Only valid after `connect()` (or the first `send()`).
   */
  readonly client: Client;
  /**
   * Connect to the MCP server by spawning the process and completing the MCP handshake.
   * Safe to call multiple times; subsequent calls are no-ops.
   */
  connect(): Promise<void>;
  /**
   * Invoke an MCP tool. Accepts the same shape as `CallToolRequest["params"]`:
   *   { name: string, arguments?: Record<string, unknown> }
   * Auto-connects on first call.
   */
  send(params: McpSendParams): Promise<CallToolResult>;
  /**
   * Close the client and terminate the spawned MCP server.
   */
  close(): Promise<void>;
};

export function connectMcp(options: ConnectMcpOptions): McpInstance {
  const {
    clientName = "agent-workflow-mcp-client",
    clientVersion = "0.0.1",
    ...serverParams
  } = options;

  const client = new Client({ name: clientName, version: clientVersion });
  let transport: StdioClientTransport | undefined;
  let connectPromise: Promise<void> | undefined;
  let closed = false;

  const connect = async () => {
    if (closed) throw new Error("connectMcp instance is already closed");
    if (!connectPromise) {
      transport = new StdioClientTransport(serverParams);
      connectPromise = client.connect(transport);
    }
    await connectPromise;
  };

  const send = async (params: McpSendParams) => {
    await connect();
    return (await client.callTool(params)) as CallToolResult;
  };

  const close = async () => {
    if (closed) return;
    closed = true;
    try {
      await client.close();
    } finally {
      if (transport) await transport.close();
    }
  };

  return {
    get client() {
      return client;
    },
    connect,
    send,
    close,
  };
}
