import type { Db } from "@/db";
import {
	candidateSubjectKey,
	pendingGroupCandidates,
} from "@/db/engine-schema";

import type { DiscoveredGroup } from "./phases.ts";
import { convergeMembersOf } from "./phases.ts";

const queueStructuralAlignmentConflict = async (
	db: Db,
	input: {
		readonly anchorTitleId: number;
		readonly discovered: DiscoveredGroup;
		readonly evidenceHashPrefix: string;
		readonly groupId: number;
	},
): Promise<void> => {
	const subject = {
		subjectType: "title" as const,
		titleId: input.anchorTitleId,
	};
	const proposedMembers = convergeMembersOf(input.discovered)
		.map((member) => ({
			service: member.service,
			serviceId: member.serviceId,
		}))
		.toSorted((left, right) => {
			if (left.service !== right.service) {
				return left.service < right.service ? -1 : 1;
			}
			if (left.serviceId !== right.serviceId) {
				return left.serviceId < right.serviceId ? -1 : 1;
			}
			return 0;
		});
	const evidence = {
		competingGroupIds: [input.groupId],
		kind: "structural" as const,
		proposedMembers,
	};
	const membersDigest = proposedMembers
		.map((member) => `${member.service}:${member.serviceId}`)
		.toSorted()
		.join(",");
	const evidenceHash = `${input.evidenceHashPrefix}:${input.groupId}:${input.anchorTitleId}:${membersDigest}`;
	await db
		.insert(pendingGroupCandidates)
		.values({
			evidence,
			evidenceHash,
			kind: "structural",
			subject,
			subjectKey: candidateSubjectKey(subject),
		})
		.onConflictDoNothing()
		.run();
};

export { queueStructuralAlignmentConflict };
