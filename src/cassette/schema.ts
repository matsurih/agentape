import { z } from "zod";

export const HttpRequestSchema = z.object({
  method: z.string(),
  url: z.string(),
  headers: z.record(z.string()).default({}),
  body: z.unknown().nullable().default(null),
});

export const HttpResponseSchema = z.object({
  status: z.number(),
  headers: z.record(z.string()).default({}),
  body: z.unknown().nullable().default(null),
});

export const HttpInteractionSchema = z.object({
  id: z.string(),
  type: z.literal("http"),
  request: HttpRequestSchema,
  response: HttpResponseSchema,
  metadata: z
    .object({
      recordedAt: z.string().optional(),
      durationMs: z.number().optional(),
    })
    .partial()
    .default({}),
});

export const McpToolInteractionSchema = z.object({
  id: z.string(),
  type: z.literal("mcp.tool"),
  tool: z.string(),
  input: z.unknown(),
  output: z.unknown(),
  metadata: z
    .object({
      recordedAt: z.string().optional(),
      durationMs: z.number().optional(),
      isError: z.boolean().optional(),
    })
    .partial()
    .default({}),
});

export const McpRpcInteractionSchema = z.object({
  id: z.string(),
  type: z.literal("mcp.rpc"),
  rpcMethod: z.string(),
  params: z.unknown(),
  result: z.unknown().optional(),
  error: z.unknown().optional(),
  metadata: z
    .object({
      recordedAt: z.string().optional(),
      durationMs: z.number().optional(),
    })
    .partial()
    .default({}),
});

export const InteractionSchema = z.discriminatedUnion("type", [
  HttpInteractionSchema,
  McpToolInteractionSchema,
  McpRpcInteractionSchema,
]);

export const CassetteSchema = z.object({
  version: z.literal(1),
  name: z.string(),
  createdAt: z.string(),
  interactions: z.array(InteractionSchema).default([]),
});

export type HttpRequest = z.infer<typeof HttpRequestSchema>;
export type HttpResponse = z.infer<typeof HttpResponseSchema>;
export type HttpInteraction = z.infer<typeof HttpInteractionSchema>;
export type McpToolInteraction = z.infer<typeof McpToolInteractionSchema>;
export type McpRpcInteraction = z.infer<typeof McpRpcInteractionSchema>;
export type Interaction = z.infer<typeof InteractionSchema>;
export type Cassette = z.infer<typeof CassetteSchema>;

export function emptyCassette(name: string): Cassette {
  return {
    version: 1,
    name,
    createdAt: new Date().toISOString(),
    interactions: [],
  };
}
