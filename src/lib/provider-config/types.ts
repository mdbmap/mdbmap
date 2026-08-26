import { z } from "zod";

import { vercelAiSdkProviderKinds } from "@/db/schema";

// One entry per Vercel AI SDK adapter (ADR-0005); each carries only the model
// key and identifier, since the adapter itself knows how to reach its API.
const VercelAiSdkProviderConfigSchema = z.object({
	apiKey: z.string().min(1),
	kind: z.enum(vercelAiSdkProviderKinds),
	model: z.string().min(1),
});
type VercelAiSdkProviderConfig = z.infer<
	typeof VercelAiSdkProviderConfigSchema
>;

// Covers gateways (OpenRouter) and self-hosted endpoints that speak the
// OpenAI wire format but aren't one of the SDK's own adapters.
const OpenAiCompatibleProviderConfigSchema = z.object({
	apiKey: z.string().min(1),
	baseUrl: z.url(),
	kind: z.literal("openai-compatible"),
	model: z.string().min(1),
});
type OpenAiCompatibleProviderConfig = z.infer<
	typeof OpenAiCompatibleProviderConfigSchema
>;

const ProviderConfigSchema = z.union([
	VercelAiSdkProviderConfigSchema,
	OpenAiCompatibleProviderConfigSchema,
]);
type ProviderConfig = z.infer<typeof ProviderConfigSchema>;

export { ProviderConfigSchema };
export type {
	OpenAiCompatibleProviderConfig,
	ProviderConfig,
	VercelAiSdkProviderConfig,
};
