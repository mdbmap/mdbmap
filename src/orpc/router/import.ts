import { ORPCError } from "@orpc/server";
import { z } from "zod";

import { env } from "@/env";
import {
	applyImportDraft,
	buildAnilistImportDraft,
	buildMalImportDraft,
	isAnilistAccessTokenMissingError,
	isAnilistAccountNotLinkedError,
	isMalAccessTokenMissingError,
	isMalAccountNotLinkedError,
} from "@/lib/library-import";
import { authed } from "@/orpc/base";

const EmptyInput = z.object({}).strict();

const masterKeyOf = (override: string | undefined): string => {
	const key = override ?? env.PROVIDER_CONFIG_MASTER_KEY;
	if (key === undefined) {
		throw new ORPCError("INTERNAL_SERVER_ERROR", {
			message: "PROVIDER_CONFIG_MASTER_KEY is not configured.",
		});
	}
	return key;
};

const mapImportError = (error: unknown): never => {
	if (
		isMalAccountNotLinkedError(error) ||
		isAnilistAccountNotLinkedError(error)
	) {
		throw new ORPCError("NOT_FOUND", {
			message: error instanceof Error ? error.message : "Not found",
		});
	}
	if (
		isMalAccessTokenMissingError(error) ||
		isAnilistAccessTokenMissingError(error)
	) {
		throw new ORPCError("BAD_REQUEST", {
			message: error instanceof Error ? error.message : "Bad request",
		});
	}
	if (
		error instanceof Error &&
		error.message.includes("fingerprint mismatch")
	) {
		throw new ORPCError("CONFLICT", {
			message: "Import draft is stale. Reload and review again.",
		});
	}
	throw error;
};

// Import drafting reuses linked sync-account tokens and is not entitlement-gated.
const draftMal = authed.input(EmptyInput).handler(async ({ context }) => {
	try {
		return await buildMalImportDraft({
			db: context.db,
			masterKeyBase64: masterKeyOf(context.providerConfigMasterKey),
			userId: context.user.id,
		});
	} catch (error) {
		return mapImportError(error);
	}
});

const draftAnilist = authed.input(EmptyInput).handler(async ({ context }) => {
	try {
		return await buildAnilistImportDraft({
			db: context.db,
			masterKeyBase64: masterKeyOf(context.providerConfigMasterKey),
			userId: context.user.id,
		});
	} catch (error) {
		return mapImportError(error);
	}
});

const ContinuityIdSchema = z.string().min(1);
const ExternalTitleIdSchema = z.string().min(1);
const ResolutionSchema = z
	.object({
		continuityId: ContinuityIdSchema,
		externalTitleId: ExternalTitleIdSchema,
	})
	.strict();
const ResolutionsSchema = z.array(ResolutionSchema).optional();
const ApplyInput = z
	.object({
		fingerprint: z.string().min(1),
		overwriteLocal: z.boolean().optional(),
		provider: z.enum(["anilist", "mal"]),
		resolutions: ResolutionsSchema,
	})
	.strict();

const apply = authed.input(ApplyInput).handler(async ({ context, input }) => {
	try {
		const draft =
			input.provider === "mal"
				? await buildMalImportDraft({
						db: context.db,
						masterKeyBase64: masterKeyOf(context.providerConfigMasterKey),
						userId: context.user.id,
					})
				: await buildAnilistImportDraft({
						db: context.db,
						masterKeyBase64: masterKeyOf(context.providerConfigMasterKey),
						userId: context.user.id,
					});
		return await applyImportDraft({
			db: context.db,
			draft,
			engine: context.engine,
			fingerprint: input.fingerprint,
			userId: context.user.id,
			...(input.overwriteLocal === undefined
				? {}
				: { overwriteLocal: input.overwriteLocal }),
			...(input.resolutions === undefined
				? {}
				: { resolutions: input.resolutions }),
		});
	} catch (error) {
		return mapImportError(error);
	}
});

const libraryImport = { apply, draftAnilist, draftMal };

export { libraryImport };
