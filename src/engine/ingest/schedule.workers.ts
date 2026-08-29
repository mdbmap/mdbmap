import { waitUntil } from "cloudflare:workers";

const swallowFailure = async (task: Promise<void>): Promise<void> => {
	try {
		await task;
	} catch {
		return;
	}
};

/** Sync Cloudflare registration — load only from Workers (never the Vite client graph). */
const scheduleWithWaitUntil = (task: Promise<void>): void => {
	waitUntil(swallowFailure(task));
};

export { scheduleWithWaitUntil };
