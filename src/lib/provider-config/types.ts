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

// Spelled out per literal (rather than mapped from `vercelAiSdkProviderKinds`)
// so the union stays a fixed-length tuple for `z.discriminatedUnion`; the
// assertion below fails loudly if a kind is added to one list but not both.
const discriminatedVercelKinds = [
	"openai",
	"anthropic",
	"google",
	"mistral",
	"groq",
	"xai",
] as const;
if (
	discriminatedVercelKinds.length !== vercelAiSdkProviderKinds.length ||
	discriminatedVercelKinds.some(
		(kind, index) => kind !== vercelAiSdkProviderKinds[index],
	)
) {
	throw new Error(
		"provider-config: discriminatedVercelKinds drifted from db schema",
	);
}

const ProviderConfigSchema = z.discriminatedUnion("kind", [
	VercelAiSdkProviderConfigSchema.extend({ kind: z.literal("openai") }),
	VercelAiSdkProviderConfigSchema.extend({ kind: z.literal("anthropic") }),
	VercelAiSdkProviderConfigSchema.extend({ kind: z.literal("google") }),
	VercelAiSdkProviderConfigSchema.extend({ kind: z.literal("mistral") }),
	VercelAiSdkProviderConfigSchema.extend({ kind: z.literal("groq") }),
	VercelAiSdkProviderConfigSchema.extend({ kind: z.literal("xai") }),
	OpenAiCompatibleProviderConfigSchema,
]);
type ProviderConfig = z.infer<typeof ProviderConfigSchema>;

export { ProviderConfigSchema };
export type {
	OpenAiCompatibleProviderConfig,
	ProviderConfig,
	VercelAiSdkProviderConfig,
};
