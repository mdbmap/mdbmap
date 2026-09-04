import { useCallback, useState } from "react";

import type { WatchStatus } from "@/db/schema";

interface ConfirmTarget {
	continuityId: string;
	status: WatchStatus | undefined;
}

const sameTarget = (left: ConfirmTarget, right: ConfirmTarget): boolean =>
	left.continuityId === right.continuityId && left.status === right.status;

const isArmedFor = (
	armed: ConfirmTarget | undefined,
	target: ConfirmTarget,
): boolean => armed !== undefined && sameTarget(armed, target);

const disarmIfTargetChanged = (
	armed: ConfirmTarget | undefined,
	previous: ConfirmTarget,
	next: ConfirmTarget,
): ConfirmTarget | undefined =>
	sameTarget(previous, next) ? armed : undefined;

const useArmedConfirm = (target: ConfirmTarget) => {
	const [armed, setArmed] = useState<ConfirmTarget | undefined>();
	const [seenTarget, setSeenTarget] = useState(target);
	const effectiveArmed = disarmIfTargetChanged(armed, seenTarget, target);
	if (!sameTarget(seenTarget, target)) {
		setSeenTarget(target);
	}
	if (effectiveArmed !== armed) {
		setArmed(effectiveArmed);
	}
	const requestConfirm = useCallback(() => {
		setArmed(target);
	}, [target]);
	return {
		confirming: isArmedFor(effectiveArmed, target),
		requestConfirm,
	};
};

export { disarmIfTargetChanged, isArmedFor, useArmedConfirm };
export type { ConfirmTarget };
