import type { Db } from "@/db";
import { apiKey } from "@/db/schema";
import type { ApiKeyPlan } from "@/db/schema";

import { hashApiKeySecret } from "./hash.ts";

const KEY_PREFIX = "mdbmap_";
const SECRET_BYTES = 32;

const toBase64Url = (bytes: Uint8Array): string =>
	btoa(String.fromCodePoint(...bytes))
		.replaceAll("+", "-")
		.replaceAll("/", "_")
		.replaceAll("=", "");

const generateSecret = (): string =>
	`${KEY_PREFIX}${toBase64Url(crypto.getRandomValues(new Uint8Array(SECRET_BYTES)))}`;

interface IssueApiKeyInput {
	readonly label: string;
	readonly plan?: ApiKeyPlan | undefined;
}

interface IssuedApiKey {
	readonly createdAt: Date | null;
	readonly id: string;
	readonly label: string;
	readonly plan: ApiKeyPlan;
	readonly revokedAt: Date | null;
	// Present only on this return value. The secret is never stored or
	// reconstructible afterwards — only `hashApiKeySecret(secret)` is.
	readonly secret: string;
}

// Mints a key, persisting only its hash. `secret` on the result is the sole
// place the plaintext ever exists past this call — callers must show it to the
// caller now and never log or re-display it.
const issueApiKey = async (
	db: Db,
	input: IssueApiKeyInput,
): Promise<IssuedApiKey> => {
	const secret = generateSecret();
	const keyHash = await hashApiKeySecret(secret);
	const plan = input.plan ?? "free";
	const rows = await db
		.insert(apiKey)
		.values({ id: crypto.randomUUID(), keyHash, label: input.label, plan })
		.returning({
			createdAt: apiKey.createdAt,
			id: apiKey.id,
			label: apiKey.label,
			plan: apiKey.plan,
			revokedAt: apiKey.revokedAt,
		})
		.all();
	const [row] = rows;
	if (row === undefined) {
		throw new Error("api key insert returned no row");
	}
	return { ...row, secret };
};

export { issueApiKey };
export type { IssueApiKeyInput, IssuedApiKey };
