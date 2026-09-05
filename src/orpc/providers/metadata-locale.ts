interface LocalizedText {
	locale: string;
	synopsis?: string | undefined;
	tagline?: string | undefined;
	title?: string | undefined;
}

interface LocalizedTitle {
	locale: string;
	text: string;
	type?: string | undefined;
}

const localeCandidates = (locale: string): string[] => {
	const normalised = locale.trim().toLowerCase().replaceAll("_", "-");
	if (normalised === "") {
		return ["en"];
	}
	const [language] = normalised.split("-");
	return [...new Set([normalised, language ?? normalised, "en"])];
};

const localeMatches = (value: string, candidate: string): boolean => {
	const normalised = value.trim().toLowerCase().replaceAll("_", "-");
	return normalised === candidate || normalised.startsWith(`${candidate}-`);
};

const pickLocalized = (
	rows: readonly LocalizedText[],
	locale: string,
): LocalizedText | undefined => {
	const candidates = localeCandidates(locale);
	for (const candidate of candidates) {
		const hit = rows.find(
			(row) =>
				localeMatches(row.locale, candidate) &&
				((row.title !== undefined && row.title !== "") ||
					(row.synopsis !== undefined && row.synopsis !== "") ||
					(row.tagline !== undefined && row.tagline !== "")),
		);
		if (hit !== undefined) {
			return hit;
		}
	}
	return rows.find(
		(row) =>
			(row.title !== undefined && row.title !== "") ||
			(row.synopsis !== undefined && row.synopsis !== ""),
	);
};

const titleRank = (type: string | undefined): number => {
	if (type === "official") {
		return 0;
	}
	if (type === "main") {
		return 1;
	}
	if (type === "syn") {
		return 2;
	}
	return 3;
};

const pickTitle = (
	titles: readonly LocalizedTitle[],
	locale: string,
	fallback: string,
): string => {
	const candidates = localeCandidates(locale);
	for (const candidate of candidates) {
		const matches = titles
			.filter(
				(title) => localeMatches(title.locale, candidate) && title.text !== "",
			)
			.toSorted((left, right) => titleRank(left.type) - titleRank(right.type));
		const [hit] = matches;
		if (hit !== undefined) {
			return hit.text;
		}
	}
	const main = titles.find(
		(title) => title.type === "main" && title.text !== "",
	);
	if (main !== undefined) {
		return main.text;
	}
	return titles.find((title) => title.text !== "")?.text ?? fallback;
};

export { localeCandidates, pickLocalized, pickTitle };
export type { LocalizedText, LocalizedTitle };
