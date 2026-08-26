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

export { one };
