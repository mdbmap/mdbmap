function parseContinuityKey(key: string): number | undefined {
	const [type, rawId, extra] = key.split(":");
	if (
		extra !== undefined ||
		rawId === undefined ||
		!/^\d+$/u.test(rawId) ||
		type !== "continuity"
	) {
		return undefined;
	}
	return Number(rawId);
}

function parseWorkPathId(raw: string): number | undefined {
	if (!/^[1-9]\d*$/u.test(raw)) {
		return undefined;
	}
	return Number(raw);
}

function workPathId(raw: string): number | undefined {
	return parseWorkPathId(raw) ?? parseContinuityKey(raw);
}

function continuityKey(id: number): `continuity:${number}` {
	return `continuity:${id}`;
}

export { continuityKey, parseContinuityKey, parseWorkPathId, workPathId };
