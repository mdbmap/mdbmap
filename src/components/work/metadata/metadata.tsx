import type { Credit, Similar } from "@/orpc/schema";

import { CastSection } from "./cast";
import { IfYouLiked } from "./if-you-liked";
import { StaffSection } from "./staff";
import { StudiosSection } from "./studios";

interface MetadataProps {
	cast: Credit[];
	ifYouLiked: Similar[];
	staff: Credit[];
	studios: string[];
}

function Metadata({ cast, ifYouLiked, staff, studios }: MetadataProps) {
	return (
		<>
			{cast.length > 0 && <CastSection cast={cast} />}
			{staff.length > 0 && <StaffSection staff={staff} />}
			{studios.length > 0 && <StudiosSection studios={studios} />}
			{ifYouLiked.length > 0 && <IfYouLiked items={ifYouLiked} />}
		</>
	);
}

export { Metadata };
