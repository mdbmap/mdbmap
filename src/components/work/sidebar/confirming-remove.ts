import type { WatchStatus } from "@/db/schema";

interface ConfirmTarget {
	continuityId: string;
	status: WatchStatus | undefined;
}

const isArmedFor = (
	armed: ConfirmTarget | undefined,
	target: ConfirmTarget,
): boolean =>
	armed !== undefined &&
	armed.continuityId === target.continuityId &&
	armed.status === target.status;

export { isArmedFor };
export type { ConfirmTarget };
