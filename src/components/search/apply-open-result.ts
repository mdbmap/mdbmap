import { workPathId } from "@/engine/continuity/keys";
import type { WorkOpenResult } from "@/orpc/schema";

import { actionForOpenResult, ERROR_BODY } from "./open-hit";
import type { OpenHitState } from "./open-hit";

interface NavigateArgs {
	params: { continuityId: number };
	to: "/work/$continuityId";
}

const applyOpenResult = (
	result: WorkOpenResult,
	navigate: (args: NavigateArgs) => unknown,
	setState: (state: OpenHitState) => void,
): void => {
	const action = actionForOpenResult(result);
	if (action.kind === "navigate") {
		const continuityId = workPathId(action.continuityId);
		if (continuityId === undefined) {
			setState({ kind: "error", message: ERROR_BODY });
			return;
		}
		void navigate({
			params: { continuityId },
			to: "/work/$continuityId",
		});
		return;
	}
	setState(action);
};

export { applyOpenResult };
