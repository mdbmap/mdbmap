import type { ChangeEvent } from "react";
import { useCallback } from "react";

import type { WatchStatus } from "@/db/schema";

const STATUSES: readonly WatchStatus[] = [
	"watching",
	"on_hold",
	"completed",
	"dropped",
	"rewatching",
];

const UNSET = "";
const UNSET_LABEL = "set status";

const formatStatus = (status: WatchStatus) => status.replace("_", " ");

interface StatusSelectProps {
	disabled?: boolean;
	onChange: (status: WatchStatus) => void;
	value: WatchStatus | undefined;
}

function StatusSelect({ disabled, onChange, value }: StatusSelectProps) {
	const handleChange = useCallback(
		(event: ChangeEvent<HTMLSelectElement>) => {
			const next = STATUSES.find((status) => status === event.target.value);
			if (next) {
				onChange(next);
			}
		},
		[onChange],
	);
	return (
		<select
			aria-label="Watch status"
			className="font-round text-ink/90 mt-3 cursor-pointer appearance-none border-none bg-transparent p-0 text-[15px] font-medium capitalize outline-none disabled:cursor-not-allowed"
			disabled={disabled}
			onChange={handleChange}
			value={value ?? UNSET}
		>
			{value === undefined && (
				<option disabled value={UNSET}>
					{UNSET_LABEL}
				</option>
			)}
			{STATUSES.map((status) => (
				<option key={status} value={status}>
					{formatStatus(status)}
				</option>
			))}
		</select>
	);
}

export { StatusSelect };
