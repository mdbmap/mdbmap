// The scoring primitives T3 leans on. Each is pure and side-effect free, so the
// tier can compose them without any knowledge of how a title or date was fetched.

const MILLIS_PER_DAY = 86_400_000;
const CHAR_WEIGHT = 0.5;
const TOKEN_WEIGHT = 0.5;

// Lowercase, drop every non-alphanumeric character (unicode aware) and collapse
// the gaps, so "Pups Save the Bay!" and "pups save the bay" normalise alike.
const normaliseTitle = (title: string): string =>
	title
		.toLowerCase()
		.replaceAll(/[^\p{L}\p{N}]+/gu, " ")
		.trim();

const tokenise = (normalised: string): readonly string[] =>
	normalised.length === 0 ? [] : normalised.split(" ");

// Levenshtein over two rolling rows. Bounds are guaranteed by the loops, so the
// `?? 0` reads only satisfy noUncheckedIndexedAccess and are never taken.
const editDistance = (left: string, right: string): number => {
	if (left === right) {
		return 0;
	}
	if (left.length === 0) {
		return right.length;
	}
	if (right.length === 0) {
		return left.length;
	}
	let previous = Array.from({ length: right.length + 1 }, (_ignored, col) => col);
	for (let row = 1; row <= left.length; row += 1) {
		const current = [row];
		for (let col = 1; col <= right.length; col += 1) {
			const cost = left[row - 1] === right[col - 1] ? 0 : 1;
			current[col] = Math.min(
				(current[col - 1] ?? 0) + 1,
				(previous[col] ?? 0) + 1,
				(previous[col - 1] ?? 0) + cost,
			);
		}
		previous = current;
	}
	return previous[right.length] ?? 0;
};

// Jaccard overlap of the two token sets: shared tokens over the size of their
// union, so word order and repeats never sway it.
const tokenOverlap = (
	left: readonly string[],
	right: readonly string[],
): number => {
	const leftSet = new Set(left);
	const rightSet = new Set(right);
	if (leftSet.size === 0 || rightSet.size === 0) {
		return 0;
	}
	let shared = 0;
	for (const token of leftSet) {
		if (rightSet.has(token)) {
			shared += 1;
		}
	}
	return shared / new Set([...leftSet, ...rightSet]).size;
};

// Normalised similarity in [0, 1]: half from character edits, half from token
// overlap. Either side empty after normalisation yields 0.
const titleSimilarity = (left: string, right: string): number => {
	const leftNorm = normaliseTitle(left);
	const rightNorm = normaliseTitle(right);
	if (leftNorm.length === 0 || rightNorm.length === 0) {
		return 0;
	}
	const longer = Math.max(leftNorm.length, rightNorm.length);
	const charScore = 1 - editDistance(leftNorm, rightNorm) / longer;
	const overlap = tokenOverlap(tokenise(leftNorm), tokenise(rightNorm));
	return charScore * CHAR_WEIGHT + overlap * TOKEN_WEIGHT;
};

// Whole-day gap between two dates, or undefined when either fails to parse, so
// the caller treats an unparseable date as absent evidence rather than a match.
const dayDistance = (left: string, right: string): number | undefined => {
	const leftMillis = Date.parse(left);
	const rightMillis = Date.parse(right);
	if (Number.isNaN(leftMillis) || Number.isNaN(rightMillis)) {
		return undefined;
	}
	return Math.round(Math.abs(leftMillis - rightMillis) / MILLIS_PER_DAY);
};

export { dayDistance, editDistance, normaliseTitle, titleSimilarity, tokenOverlap };
