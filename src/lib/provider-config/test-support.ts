import { bytesToBase64 } from "./crypto.ts";

const randomMasterKey = (): string => {
	const bytes = crypto.getRandomValues(new Uint8Array(32));
	return bytesToBase64(bytes);
};

export { randomMasterKey };
