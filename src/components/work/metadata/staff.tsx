import { Section } from "@/components/ui/section";
import { SectionHead } from "@/components/ui/section-head";
import type { Credit } from "@/orpc/schema";

const HEADING = "Staff";

function StaffCard({ credit }: { credit: Credit }) {
	return (
		<div>
			<div className="text-ink/90 text-[13px] font-medium">{credit.name}</div>
			<div className="text-ink/45 mt-0.5 font-mono text-[10.5px]">
				{credit.role}
			</div>
		</div>
	);
}

function StaffSection({ staff }: { staff: Credit[] }) {
	return (
		<Section>
			<SectionHead>{HEADING}</SectionHead>
			<div className="mt-3.5 grid grid-cols-2 gap-x-4 gap-y-3.5 sm:grid-cols-3">
				{staff.map((credit) => (
					<StaffCard credit={credit} key={credit.role} />
				))}
			</div>
		</Section>
	);
}

export { StaffSection };
