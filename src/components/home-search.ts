interface HomeSearch {
	signin?: true | undefined;
}

const parseHomeSearch = (search: Record<string, unknown>): HomeSearch => {
	const { signin } = search;
	const requested =
		signin === "1" || signin === "true" || signin === 1 || signin === true;
	return requested ? { signin: true } : {};
};

export { parseHomeSearch, type HomeSearch };
