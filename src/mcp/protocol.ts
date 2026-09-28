/**
 * Minimal MCP (Model Context Protocol) server plumbing over stdio.
 *
 * MCP frames JSON-RPC 2.0 messages as newline-delimited JSON on stdin/stdout.
 * Only the subset a tool server needs is implemented: `initialize`, `ping`,
 * `tools/list` and `tools/call`. Notifications (messages without an `id`) are
 * acknowledged by being ignored, as the spec requires.
 */
import * as readline from 'readline';

export const PROTOCOL_VERSION = '2025-06-18';

export interface JsonSchema {
  type: string;
  description?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  enum?: string[];
  default?: unknown;
  items?: JsonSchema;
  additionalProperties?: boolean;
}

export interface ToolAnnotations {
  title?: string;
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}

export interface McpTool {
  name: string;
  description: string;
  inputSchema: JsonSchema;
  annotations?: ToolAnnotations;
  handler: (args: Record<string, unknown>) => Promise<string>;
}

export interface McpServerOptions {
  name: string;
  version: string;
  instructions?: string;
  tools: McpTool[];
  /** Receives one diagnostic line; stdout is reserved for protocol traffic. */
  log?: (message: string) => void;
}

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

const JSON_RPC_ERRORS: Record<number, string> = {
  [-32700]: 'Parse error',
  [-32600]: 'Invalid Request',
  [-32601]: 'Method not found',
  [-32602]: 'Invalid params',
  [-32603]: 'Internal error',
};

/** Converts an unknown throwable into a readable message. */
function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

/**
 * Validates arguments against the subset of JSON Schema the tools use:
 * required properties, declared types and enums. Returns a list of problems so
 * the caller gets one actionable message instead of a generic failure.
 */
export function validateArgs(schema: JsonSchema, args: Record<string, unknown>): string[] {
  const problems: string[] = [];
  const properties = schema.properties ?? {};

  for (const key of schema.required ?? []) {
    if (args[key] === undefined || args[key] === null) {
      problems.push(`missing required parameter "${key}"`);
    }
  }

  for (const [key, value] of Object.entries(args)) {
    const prop = properties[key];
    if (!prop || value === undefined || value === null) continue;

    if (prop.enum && typeof value === 'string' && !prop.enum.includes(value)) {
      problems.push(`"${key}" must be one of: ${prop.enum.join(', ')} (received "${value}")`);
      continue;
    }

    const actual = Array.isArray(value) ? 'array' : typeof value;
    if (prop.type === 'string' && actual !== 'string') {
      problems.push(`"${key}" must be a string (received ${actual})`);
    } else if (prop.type === 'number' && actual !== 'number') {
      problems.push(`"${key}" must be a number (received ${actual})`);
    } else if (prop.type === 'boolean' && actual !== 'boolean') {
      problems.push(`"${key}" must be a boolean (received ${actual})`);
    } else if (prop.type === 'array' && actual !== 'array') {
      problems.push(`"${key}" must be an array (received ${actual})`);
    } else if (prop.type === 'object' && actual !== 'object') {
      problems.push(`"${key}" must be an object (received ${actual})`);
    }
  }

  return problems;
}

/**
 * Dispatches a single JSON-RPC request. Returns the response object, or null
 * for notifications which must not be answered.
 */
export async function handleRequest(
  message: JsonRpcRequest,
  options: McpServerOptions,
): Promise<Record<string, unknown> | null> {
  const isNotification = message.id === undefined || message.id === null;
  const reply = (result: unknown): Record<string, unknown> => ({
    jsonrpc: '2.0',
    id: message.id ?? null,
    result,
  });
  const fail = (code: number, detail: string): Record<string, unknown> => ({
    jsonrpc: '2.0',
    id: message.id ?? null,
    error: { code, message: JSON_RPC_ERRORS[code] ?? 'Error', data: detail },
  });

  switch (message.method) {
    case 'initialize': {
      if (isNotification) return null;
      const requested = (message.params as { protocolVersion?: string } | undefined)?.protocolVersion;
      return reply({
        // Echo the client's version when it is one we know, otherwise advertise ours.
        protocolVersion: requested ?? PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: options.name, version: options.version },
        ...(options.instructions ? { instructions: options.instructions } : {}),
      });
    }

    case 'notifications/initialized':
    case 'notifications/cancelled':
      return null;

    case 'ping':
      return isNotification ? null : reply({});

    case 'tools/list':
      return reply({
        tools: options.tools.map((tool) => ({
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema,
          ...(tool.annotations ? { annotations: tool.annotations } : {}),
        })),
      });

    case 'tools/call': {
      if (isNotification) return null;
      const params = (message.params ?? {}) as { name?: string; arguments?: Record<string, unknown> };
      const tool = options.tools.find((t) => t.name === params.name);
      if (!tool) {
        return fail(-32602, `Unknown tool "${params.name ?? ''}". Available: ${options.tools.map((t) => t.name).join(', ')}`);
      }

      const args = params.arguments ?? {};
      const problems = validateArgs(tool.inputSchema, args);
      if (problems.length > 0) {
        return reply({
          content: [{ type: 'text', text: `Invalid arguments for ${tool.name}:\n- ${problems.join('\n- ')}` }],
          isError: true,
        });
      }

      try {
        const text = await tool.handler(args);
        return reply({ content: [{ type: 'text', text }], isError: false });
      } catch (err) {
        // Tool failures are reported as tool results, not protocol errors, so
        // the model can read the message and react.
        options.log?.(`${tool.name} failed: ${errorMessage(err)}`);
        return reply({
          content: [{ type: 'text', text: `${tool.name} failed: ${errorMessage(err)}` }],
          isError: true,
        });
      }
    }

    default:
      if (isNotification) return null;
      return fail(-32601, `Unsupported method "${message.method}"`);
  }
}

/** Reads newline-delimited JSON-RPC messages from stdin and writes responses. */
export function startStdioServer(options: McpServerOptions): void {
  const write = (payload: Record<string, unknown>): void => {
    process.stdout.write(`${JSON.stringify(payload)}\n`);
  };

  const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });

  // Requests are handled strictly in order. JSON-RPC allows out-of-order
  // replies, but tool calls are sequential in practice and some clients assume
  // the responses arrive in request order, so the queue keeps it predictable.
  let queue: Promise<void> = Promise.resolve();

  rl.on('line', (line: string) => {
    const trimmed = line.trim();
    if (!trimmed) return;

    queue = queue.then(async () => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(trimmed);
      } catch {
        write({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
        return;
      }

      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        write({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid Request' } });
        return;
      }

      const request = parsed as JsonRpcRequest;
      try {
        const response = await handleRequest(request, options);
        if (response) write(response);
      } catch (err) {
        options.log?.(`unhandled error: ${errorMessage(err)}`);
        if (request.id !== undefined && request.id !== null) {
          write({
            jsonrpc: '2.0',
            id: request.id,
            error: { code: -32603, message: 'Internal error', data: errorMessage(err) },
          });
        }
      }
    });
  });

  rl.on('close', () => process.exit(0));
}
