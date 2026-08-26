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

// Admin edit form: omit `apiKey` (or leave it empty) to keep the stored key.
const UpdateProviderConfigSchema = z.union([
	z.object({
		apiKey: z.string().min(1).optional(),
		kind: z.enum(vercelAiSdkProviderKinds),
		model: z.string().min(1),
	}),
	z.object({
		apiKey: z.string().min(1).optional(),
		baseUrl: z.url(),
		kind: z.literal("openai-compatible"),
		model: z.string().min(1),
	}),
]);
type UpdateProviderConfig = z.infer<typeof UpdateProviderConfigSchema>;

type ProviderPublicConfig =
	| Omit<VercelAiSdkProviderConfig, "apiKey">
	| Omit<OpenAiCompatibleProviderConfig, "apiKey">;

const toPublicConfig = (config: ProviderConfig): ProviderPublicConfig => {
	if (config.kind === "openai-compatible") {
		return {
			baseUrl: config.baseUrl,
			kind: config.kind,
			model: config.model,
		};
	}
	return { kind: config.kind, model: config.model };
};

const mergeProviderConfig = (
	existing: ProviderConfig,
	update: UpdateProviderConfig,
): ProviderConfig => {
	const apiKey = update.apiKey ?? existing.apiKey;
	if (update.kind === "openai-compatible") {
		return {
			apiKey,
			baseUrl: update.baseUrl,
			kind: update.kind,
			model: update.model,
		};
	}
	return { apiKey, kind: update.kind, model: update.model };
};

export {
	ProviderConfigSchema,
	UpdateProviderConfigSchema,
	mergeProviderConfig,
	toPublicConfig,
};
export type {
	OpenAiCompatibleProviderConfig,
	ProviderConfig,
	ProviderPublicConfig,
	UpdateProviderConfig,
	VercelAiSdkProviderConfig,
};
