const one = <Row>(
	rows: readonly Row[],
	message = "expected an inserted row",
): Row => {
	const [row] = rows;
	if (row === undefined) {
		throw new Error(message);
	}
	return row;
};

const ascendingPair = (
	left: number,
	right: number,
): readonly [number, number] => (left < right ? [left, right] : [right, left]);

export { ascendingPair, one };
