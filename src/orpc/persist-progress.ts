import { runAtomicBatch } from "@/db/atomic";
import type { Db } from "@/orpc/context";

const gateStatement = (database: D1Database, operationId: string) =>
	database
		.prepare(
			"INSERT INTO atomic_write_gates (operation_id) VALUES (?) RETURNING operation_id",
		)
		.bind(operationId);

const dropGateStatement = (database: D1Database, operationId: string) =>
	database
		.prepare("DELETE FROM atomic_write_gates WHERE operation_id = ?")
		.bind(operationId);

const lockWatchStatusStatement = (
	database: D1Database,
	userId: string,
	continuityId: string,
): D1PreparedStatement =>
	database
		.prepare(
			`INSERT INTO watch_status (user_id, continuity_key, status)
			 VALUES (?, ?, 'watching')
			 ON CONFLICT(user_id, continuity_key) DO UPDATE SET
			   continuity_key = excluded.continuity_key`,
		)
		.bind(userId, continuityId);

const writeProgressStatement = (
	database: D1Database,
	userId: string,
	locatorsJson: string,
	watched: boolean,
): D1PreparedStatement => {
	if (watched) {
		return database
			.prepare(
				`INSERT OR IGNORE INTO episode_progress (user_id, instalment_locator)
				 SELECT ?, expected.value FROM json_each(?) AS expected`,
			)
			.bind(userId, locatorsJson);
	}
	return database
		.prepare(
			`DELETE FROM episode_progress
			 WHERE user_id = ? AND instalment_locator IN (
			   SELECT expected.value FROM json_each(?) AS expected
			 )`,
		)
		.bind(userId, locatorsJson);
};

const upsertDerivedStatusStatement = (
	database: D1Database,
	userId: string,
	continuityId: string,
	ownedJson: string,
): D1PreparedStatement =>
	database
		.prepare(
			`INSERT INTO watch_status (user_id, continuity_key, status)
			 SELECT ?, ?, CASE
			   WHEN json_array_length(?) = 0 THEN 'watching'
			   WHEN (
			     SELECT COUNT(*) FROM episode_progress
			     WHERE user_id = ? AND instalment_locator IN (
			       SELECT expected.value FROM json_each(?) AS expected
			     )
			   ) = json_array_length(?) THEN 'completed'
			   ELSE 'watching'
			 END
			 WHERE true
			 ON CONFLICT(user_id, continuity_key) DO UPDATE SET status = excluded.status`,
		)
		.bind(userId, continuityId, ownedJson, userId, ownedJson, ownedJson);

interface PersistProgress {
	continuityId: string;
	db: Db;
	locators: readonly string[];
	owned: readonly string[];
	userId: string;
	watched: boolean;
}

const persistProgressAndStatus = async ({
	continuityId,
	db,
	locators,
	owned,
	userId,
	watched,
}: PersistProgress): Promise<void> => {
	if (locators.length === 0) {
		return;
	}
	const locatorsJson = JSON.stringify(locators);
	const ownedJson = JSON.stringify([...new Set(owned)]);
	await runAtomicBatch(db, (database, operationId) => [
		gateStatement(database, operationId),
		lockWatchStatusStatement(database, userId, continuityId),
		writeProgressStatement(database, userId, locatorsJson, watched),
		upsertDerivedStatusStatement(database, userId, continuityId, ownedJson),
		dropGateStatement(database, operationId),
	]);
};

export { persistProgressAndStatus };
