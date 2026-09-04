import type { MediaKind } from "@/engine";
import type { Profile } from "@/engine/identity.ts";
import type { CatalogueTitle, WorkOpenResult } from "@/orpc/schema";

const OPENING = "Opening…";
const UNKNOWN_BODY = "This title could not be opened from the catalogues.";
const CONFLICT_BODY =
	"This title needs a review before it can be opened. Try again later.";
const ERROR_BODY = "Something went wrong opening this title. Try again.";

type OpenHitState =
	| { kind: "idle" }
	| { kind: "opening" }
	| { kind: "pending"; message: string }
	| { kind: "error"; message: string };

type OpenHitAction =
	| { kind: "navigate"; continuityId: string }
	| { kind: "pending"; message: string }
	| { kind: "error"; message: string };

const profileForMediaKind = (mediaKind: MediaKind): Profile => {
	switch (mediaKind) {
		case "anime": {
			return "anime";
		}
		case "film": {
			return "movie";
		}
		case "tv": {
			return "series";
		}
	}
};

const openInputFor = (catalogue: CatalogueTitle, mediaKind: MediaKind) => ({
	identity: { kind: "title" as const, title: catalogue },
	profile: profileForMediaKind(mediaKind),
});

const actionForOpenResult = (result: WorkOpenResult): OpenHitAction => {
	switch (result.kind) {
		case "ready":
		case "pending": {
			return { continuityId: result.continuityId, kind: "navigate" };
		}
		case "unknown": {
			return { kind: "error", message: UNKNOWN_BODY };
		}
		case "conflict": {
			return { kind: "error", message: CONFLICT_BODY };
		}
	}
};

export {
	actionForOpenResult,
	ERROR_BODY,
	OPENING,
	openInputFor,
	type OpenHitAction,
	type OpenHitState,
};
