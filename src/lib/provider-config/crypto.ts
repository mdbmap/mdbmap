// AES-GCM envelope encryption (ADR-0005): each record gets its own data key,
// which in turn is encrypted ("wrapped") under the deploy-time master key.
// Compromising the ciphertext alone yields nothing; compromising D1 alone
// yields nothing either, since the master key never touches the database.

const ALGORITHM = "AES-GCM";
const IV_LENGTH_BYTES = 12;
const DATA_KEY_LENGTH_BYTES = 32;

interface Envelope {
	readonly ciphertext: string;
	readonly dataIv: string;
	readonly wrapIv: string;
	readonly wrappedKey: string;
}

const bytesToBase64 = (bytes: Uint8Array<ArrayBuffer>): string => {
	let binary = "";
	for (const byte of bytes) {
		binary += String.fromCodePoint(byte);
	}
	return btoa(binary);
};

const base64ToBytes = (value: string): Uint8Array<ArrayBuffer> => {
	const binary = atob(value);
	const bytes = new Uint8Array(binary.length);
	for (let index = 0; index < binary.length; index += 1) {
		bytes[index] = binary.codePointAt(index) ?? 0;
	}
	return bytes;
};

const importKey = async (
	raw: Uint8Array<ArrayBuffer>,
	usage: "decrypt" | "encrypt",
) => crypto.subtle.importKey("raw", raw, ALGORITHM, false, [usage]);

const randomBytes = (length: number): Uint8Array<ArrayBuffer> =>
	crypto.getRandomValues(new Uint8Array(length));

const encryptionParams = (
	iv: Uint8Array<ArrayBuffer>,
	additionalData: string,
) => ({
	additionalData: new TextEncoder().encode(additionalData),
	iv,
	name: ALGORITHM,
});

/** Encrypts `plaintext` under a fresh data key, itself wrapped by `masterKeyBase64`. */
const encryptEnvelope = async (
	plaintext: string,
	masterKeyBase64: string,
	additionalData: string,
): Promise<Envelope> => {
	const masterKey = await importKey(base64ToBytes(masterKeyBase64), "encrypt");
	const dataKeyBytes = randomBytes(DATA_KEY_LENGTH_BYTES);
	const dataKey = await importKey(dataKeyBytes, "encrypt");

	const dataIv = randomBytes(IV_LENGTH_BYTES);
	const ciphertext = await crypto.subtle.encrypt(
		encryptionParams(dataIv, additionalData),
		dataKey,
		new TextEncoder().encode(plaintext),
	);

	const wrapIv = randomBytes(IV_LENGTH_BYTES);
	const wrappedKey = await crypto.subtle.encrypt(
		encryptionParams(wrapIv, additionalData),
		masterKey,
		dataKeyBytes,
	);

	return {
		ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
		dataIv: bytesToBase64(dataIv),
		wrapIv: bytesToBase64(wrapIv),
		wrappedKey: bytesToBase64(new Uint8Array(wrappedKey)),
	};
};

/** Reverses {@link encryptEnvelope}; rejects if `masterKeyBase64` cannot unwrap the data key. */
const decryptEnvelope = async (
	envelope: Envelope,
	masterKeyBase64: string,
	additionalData: string,
): Promise<string> => {
	const masterKey = await importKey(base64ToBytes(masterKeyBase64), "decrypt");

	let dataKeyBytes: ArrayBuffer;
	try {
		dataKeyBytes = await crypto.subtle.decrypt(
			encryptionParams(base64ToBytes(envelope.wrapIv), additionalData),
			masterKey,
			base64ToBytes(envelope.wrappedKey),
		);
	} catch (error) {
		throw new Error(
			"provider-config: master key could not unwrap the data key",
			{
				cause: error,
			},
		);
	}

	const dataKey = await importKey(new Uint8Array(dataKeyBytes), "decrypt");
	try {
		const plaintext = await crypto.subtle.decrypt(
			encryptionParams(base64ToBytes(envelope.dataIv), additionalData),
			dataKey,
			base64ToBytes(envelope.ciphertext),
		);
		return new TextDecoder().decode(plaintext);
	} catch (error) {
		throw new Error("provider-config: encrypted config failed authentication", {
			cause: error,
		});
	}
};

export { bytesToBase64, decryptEnvelope, encryptEnvelope };
export type { Envelope };
