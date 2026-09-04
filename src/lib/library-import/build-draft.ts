import type { Db } from "@/db";
import { readSyncAccountCredentials } from "@/lib/sync-accounts";

import { fetchAnilistAnimeList } from "./anilist-list.ts";
import type { FetchAnilistListInput } from "./anilist-list.ts";
import { fetchMalAnimeList } from "./mal-list.ts";
import type { FetchMalListInput } from "./mal-list.ts";
import { matchAnilistEntries, matchMalEntries } from "./match.ts";
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

interface BuildAnilistImportDraftInput {
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
const ANILIST_ACCOUNT_NOT_LINKED = "AnilistAccountNotLinkedError";
const ANILIST_ACCESS_TOKEN_MISSING = "AnilistAccessTokenMissingError";

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

const anilistAccountNotLinkedError = (): Error => {
	const error = new Error("No linked AniList account.");
	error.name = ANILIST_ACCOUNT_NOT_LINKED;
	return error;
};

const anilistAccessTokenMissingError = (): Error => {
	const error = new Error("Linked AniList account has no access token.");
	error.name = ANILIST_ACCESS_TOKEN_MISSING;
	return error;
};

const isMalAccountNotLinkedError = (error: unknown): boolean =>
	error instanceof Error && error.name === MAL_ACCOUNT_NOT_LINKED;

const isMalAccessTokenMissingError = (error: unknown): boolean =>
	error instanceof Error && error.name === MAL_ACCESS_TOKEN_MISSING;

const isAnilistAccountNotLinkedError = (error: unknown): boolean =>
	error instanceof Error && error.name === ANILIST_ACCOUNT_NOT_LINKED;

const isAnilistAccessTokenMissingError = (error: unknown): boolean =>
	error instanceof Error && error.name === ANILIST_ACCESS_TOKEN_MISSING;

const resolveProviderAccessToken = async (
	input: {
		readonly accessToken?: string;
		readonly db: Db;
		readonly masterKeyBase64: string;
		readonly provider: "anilist" | "mal";
		readonly userId: string;
	},
	notLinked: () => Error,
	tokenMissing: () => Error,
): Promise<string> => {
	if (input.accessToken !== undefined) {
		return input.accessToken;
	}
	const credentials = await readSyncAccountCredentials(
		input.db,
		input.masterKeyBase64,
		input.userId,
		input.provider,
	);
	if (credentials === undefined) {
		throw notLinked();
	}
	if (credentials.accessToken === undefined) {
		throw tokenMissing();
	}
	return credentials.accessToken;
};

const buildMalImportDraft = async (
	input: BuildMalImportDraftInput,
): Promise<ImportDraft> => {
	const accessToken = await resolveProviderAccessToken(
		{ ...input, provider: "mal" },
		malAccountNotLinkedError,
		malAccessTokenMissingError,
	);
	const fetchInput: FetchMalListInput = {
		accessToken,
		...(input.baseUrl === undefined ? {} : { baseUrl: input.baseUrl }),
		...(input.fetchImpl === undefined ? {} : { fetchImpl: input.fetchImpl }),
		...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs }),
	};
	const entries = await fetchMalAnimeList(fetchInput);
	return matchMalEntries(input.db, entries);
};

const buildAnilistImportDraft = async (
	input: BuildAnilistImportDraftInput,
): Promise<ImportDraft> => {
	const accessToken = await resolveProviderAccessToken(
		{ ...input, provider: "anilist" },
		anilistAccountNotLinkedError,
		anilistAccessTokenMissingError,
	);
	const fetchInput: FetchAnilistListInput = {
		accessToken,
		...(input.baseUrl === undefined ? {} : { baseUrl: input.baseUrl }),
		...(input.fetchImpl === undefined ? {} : { fetchImpl: input.fetchImpl }),
		...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs }),
	};
	const entries = await fetchAnilistAnimeList(fetchInput);
	return matchAnilistEntries(input.db, entries);
};

export {
	anilistAccessTokenMissingError,
	anilistAccountNotLinkedError,
	buildAnilistImportDraft,
	buildMalImportDraft,
	isAnilistAccessTokenMissingError,
	isAnilistAccountNotLinkedError,
	isMalAccessTokenMissingError,
	isMalAccountNotLinkedError,
	malAccessTokenMissingError,
	malAccountNotLinkedError,
};
export type { BuildAnilistImportDraftInput, BuildMalImportDraftInput };
