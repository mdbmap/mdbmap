import { Label } from "@/components/ui/label";
import type { CommunityScore } from "@/orpc/schema";

import { CommunityRow } from "./community-row";

const HEADING = "mdbmap · whole series";

interface CommunityBlockProps {
	score: CommunityScore;
}

function CommunityBlock({ score }: CommunityBlockProps) {
	return (
		<div>
			<Label>{HEADING}</Label>
			<CommunityRow count={score.count} mean={score.mean} />
		</div>
	);
}

export { CommunityBlock };
