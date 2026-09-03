interface HomeSearch {
	signin?: true | undefined;
}

// `/library` sends unauthenticated visitors to `/?signin=1`.
const parseHomeSearch = (search: Record<string, unknown>): HomeSearch => {
	const { signin } = search;
	const requested = signin === "1" || signin === 1 || signin === true;
	return requested ? { signin: true } : {};
};

export { parseHomeSearch, type HomeSearch };
