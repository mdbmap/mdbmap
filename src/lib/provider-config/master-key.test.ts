import { describe, expect, it } from "vitest";

import { ProviderConfigMasterKeySchema } from "./master-key.ts";
import { randomMasterKey } from "./test-support.ts";

describe("ProviderConfigMasterKeySchema", () => {
	it("accepts a base64-encoded 32-byte key", () => {
		expect(ProviderConfigMasterKeySchema.parse(randomMasterKey())).toHaveLength(
			44,
		);
	});

	it.each(["not-base64", btoa("too short"), `${randomMasterKey()}=`])(
		"rejects malformed key %s",
		(value) => {
			expect(ProviderConfigMasterKeySchema.safeParse(value).success).toBe(
				false,
			);
		},
	);
});
