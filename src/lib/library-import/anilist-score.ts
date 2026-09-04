type ScoreFormat =
	| "POINT_100"
	| "POINT_10"
	| "POINT_10_DECIMAL"
	| "POINT_5"
	| "POINT_3";

const SCORE_FORMATS = [
	"POINT_100",
	"POINT_10",
	"POINT_10_DECIMAL",
	"POINT_5",
	"POINT_3",
] as const;

/** Normalize AniList scores onto the shared 1–10 scale using the viewer's format. */
const scoreOf = (
	score: number | undefined,
	format: ScoreFormat | undefined,
): number | undefined => {
	if (score === undefined || score <= 0) {
		return undefined;
	}
	switch (format) {
		case "POINT_100": {
			return Math.round(score / 10);
		}
		case "POINT_5": {
			return Math.round(score * 2);
		}
		case "POINT_3": {
			if (score <= 1) {
				return 3;
			}
			if (score >= 3) {
				return 9;
			}
			return 6;
		}
		case "POINT_10":
		case "POINT_10_DECIMAL": {
			return score;
		}
		case undefined: {
			return score > 10 ? Math.round(score / 10) : score;
		}
		default: {
			return score;
		}
	}
};

export { SCORE_FORMATS, scoreOf };
export type { ScoreFormat };
