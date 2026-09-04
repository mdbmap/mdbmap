import type { Db } from "@/db";
import { readSyncAccountCredentials } from "@/lib/sync-accounts";

import { fetchMalAnimeList } from "./mal-list.ts";
import type { FetchMalListInput } from "./mal-list.ts";
import { matchMalEntries } from "./match.ts";
import type { ImportDraft } from "./types.ts";

interface BuildMalImportDraftInput {
	readonly accessToken?: string;
	readonly baseUrl?: string;
	readonly db: Db;
	readonly fetchImpl?: typeof fetch;
	readonly masterKeyBase64: string;
	readonly timeoutMs?: number;
	readonly userId: string;
}

const MAL_ACCOUNT_NOT_LINKED = "MalAccountNotLinkedError";
const MAL_ACCESS_TOKEN_MISSING = "MalAccessTokenMissingError";

const malAccountNotLinkedError = (): Error => {
	const error = new Error("No linked MAL account.");
	error.name = MAL_ACCOUNT_NOT_LINKED;
	return error;
};

const malAccessTokenMissingError = (): Error => {
	const error = new Error("Linked MAL account has no access token.");
	error.name = MAL_ACCESS_TOKEN_MISSING;
	return error;
};

const isMalAccountNotLinkedError = (error: unknown): boolean =>
	error instanceof Error && error.name === MAL_ACCOUNT_NOT_LINKED;

const isMalAccessTokenMissingError = (error: unknown): boolean =>
	error instanceof Error && error.name === MAL_ACCESS_TOKEN_MISSING;

const resolveAccessToken = async (
	input: BuildMalImportDraftInput,
): Promise<string> => {
	if (input.accessToken !== undefined) {
		return input.accessToken;
	}
	const credentials = await readSyncAccountCredentials(
		input.db,
		input.masterKeyBase64,
		input.userId,
		"mal",
	);
	if (credentials === undefined) {
		throw malAccountNotLinkedError();
	}
	if (credentials.accessToken === undefined) {
		throw malAccessTokenMissingError();
	}
	return credentials.accessToken;
};

const buildMalImportDraft = async (
	input: BuildMalImportDraftInput,
): Promise<ImportDraft> => {
	const accessToken = await resolveAccessToken(input);
	const fetchInput: FetchMalListInput = {
		accessToken,
		...(input.baseUrl === undefined ? {} : { baseUrl: input.baseUrl }),
		...(input.fetchImpl === undefined ? {} : { fetchImpl: input.fetchImpl }),
		...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs }),
	};
	const entries = await fetchMalAnimeList(fetchInput);
	return matchMalEntries(input.db, entries);
};

export {
	buildMalImportDraft,
	isMalAccessTokenMissingError,
	isMalAccountNotLinkedError,
	malAccessTokenMissingError,
	malAccountNotLinkedError,
};
export type { BuildMalImportDraftInput };
