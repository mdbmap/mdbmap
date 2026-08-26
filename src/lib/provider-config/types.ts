import { z } from "zod";

import { vercelAiSdkProviderKinds } from "@/db/schema";

// One entry per Vercel AI SDK adapter (ADR-0005); each carries only the model
// key and identifier, since the adapter itself knows how to reach its API.
const ApiKeySchema = z.string().trim().min(1);

const VercelAiSdkProviderConfigSchema = z.object({
	apiKey: ApiKeySchema,
	kind: z.enum(vercelAiSdkProviderKinds),
	model: z.string().min(1),
});
type VercelAiSdkProviderConfig = z.infer<
	typeof VercelAiSdkProviderConfigSchema
>;

// Covers gateways (OpenRouter) and self-hosted endpoints that speak the
// OpenAI wire format but aren't one of the SDK's own adapters.
const OpenAiCompatibleProviderConfigSchema = z.object({
	apiKey: ApiKeySchema,
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

// Admin edit form: omit `apiKey` to keep the stored key when `kind` is unchanged.
const UpdateProviderConfigSchema = z.union([
	z.object({
		apiKey: ApiKeySchema.optional(),
		kind: z.enum(vercelAiSdkProviderKinds),
		model: z.string().min(1),
	}),
	z.object({
		apiKey: ApiKeySchema.optional(),
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

class ProviderKindKeyRequiredError extends Error {
	public constructor() {
		super("API key is required when changing provider kind");
		this.name = "ProviderKindKeyRequiredError";
	}
}

const mergeProviderConfig = (
	existing: ProviderConfig,
	update: UpdateProviderConfig,
): ProviderConfig => {
	const apiKey =
		update.kind === existing.kind
			? (update.apiKey ?? existing.apiKey)
			: update.apiKey;
	if (apiKey === undefined) {
		throw new ProviderKindKeyRequiredError();
	}
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
	ProviderKindKeyRequiredError,
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
