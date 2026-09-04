import { ORPCError } from "@orpc/server";
import { z } from "zod";

import { env } from "@/env";
import {
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

const libraryImport = { draftAnilist, draftMal };

export { libraryImport };
