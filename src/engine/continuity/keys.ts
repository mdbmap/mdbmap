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

function continuityKey(id: number): `continuity:${number}` {
	return `continuity:${id}`;
}

export { continuityKey, parseContinuityKey };
