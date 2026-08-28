import type { Db } from "@/db";
import {
	candidateSubjectKey,
	pendingGroupCandidates,
} from "@/db/engine-schema";
import { serviceOrder } from "@/engine/identity.ts";

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
	const proposedMembers = convergeMembersOf(input.discovered).flatMap(
		(member) => {
			const service = serviceOrder.find(
				(candidate) => candidate === member.service,
			);
			return service === undefined
				? []
				: [{ service, serviceId: member.serviceId }];
		},
	);
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
