import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";

// libsql detaches its connection after every transaction, so a `:memory:` db
// reopens empty on the next query. A throwaway file per db survives that and
// keeps each test isolated; the dirs are removed when the process exits.
const tempDirs: string[] = [];
process.once("exit", () => {
	for (const dir of tempDirs) {
		rmSync(dir, { force: true, recursive: true });
	}
});

const freshDb = async () => {
	const dir = mkdtempSync(`${tmpdir()}/mdbmap-test-`);
	tempDirs.push(dir);
	const client = createClient({ url: `file:${dir}/test.db` });
	await client.execute("PRAGMA foreign_keys = ON");
	const db = drizzle(client);
	await migrate(db, { migrationsFolder: "schemas/drizzle" });
	return db;
};

// drizzle wraps the driver error, so the SQLite constraint text lives on the
// cause chain rather than the top-level message. Flattens the chain so a test
// can match the constraint that fired.
const rejectionText = async (promise: Promise<unknown>): Promise<string> => {
	try {
		await promise;
	} catch (error) {
		const parts: string[] = [];
		let current: unknown = error;
		while (current instanceof Error) {
			parts.push(current.message);
			current = current.cause;
		}
		return parts.join("\n");
	}
	throw new Error("expected the query to reject");
};

export { freshDb, rejectionText };
