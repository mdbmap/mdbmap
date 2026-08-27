type ParsedContinuityKey =
	| { id: number; type: "continuity" }
	| { id: number; type: "group" };

function parseContinuityKey(key: string): ParsedContinuityKey | undefined {
	const [type, rawId, extra] = key.split(":");
	if (
		extra !== undefined ||
		rawId === undefined ||
		!/^\d+$/u.test(rawId) ||
		(type !== "continuity" && type !== "group")
	) {
		return undefined;
	}
	return { id: Number(rawId), type };
}

function continuityKey(id: number): `continuity:${number}` {
	return `continuity:${id}`;
}

function groupContinuityKey(id: number): `group:${number}` {
	return `group:${id}`;
}

export { continuityKey, groupContinuityKey, parseContinuityKey };
export type { ParsedContinuityKey };
