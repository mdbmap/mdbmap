const toHex = (buffer: ArrayBuffer): string =>
	[...new Uint8Array(buffer)]
		.map((byte) => byte.toString(16).padStart(2, "0"))
		.join("");

// SHA-256 of the full presented secret. This is the only form ADR-0006 allows
// at rest; the digest is one-way, so a leaked hash cannot be replayed as a key.
const hashApiKeySecret = async (secret: string): Promise<string> => {
	const digest = await crypto.subtle.digest(
		"SHA-256",
		new TextEncoder().encode(secret),
	);
	return toHex(digest);
};

export { hashApiKeySecret };
