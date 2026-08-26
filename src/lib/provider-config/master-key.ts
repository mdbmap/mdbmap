import { z } from "zod";

const isCanonicalBase64Key = (value: string): boolean => {
	try {
		const decoded = atob(value);
		return decoded.length === 32 && btoa(decoded) === value;
	} catch {
		return false;
	}
};

const ProviderConfigMasterKeySchema = z
	.string()
	.refine(isCanonicalBase64Key, "Expected a base64-encoded 32-byte key");

export { ProviderConfigMasterKeySchema };
