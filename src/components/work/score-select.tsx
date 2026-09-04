import type { ChangeEvent } from "react";
import { useCallback } from "react";
import { tv } from "tailwind-variants";

const SCORES = [10, 9, 8, 7, 6, 5, 4, 3, 2, 1] as const;
const UNRATED = "";
const UNRATED_LABEL = "–";

const select = tv({
	base: "cursor-pointer appearance-none border-none bg-transparent p-0 font-mono outline-none",
	variants: {
		size: {
			display: "text-accent-strong text-[46px] leading-none",
			inline: "text-ink/90 text-xs",
		},
	},
});

interface ScoreSelectProps {
	label: string;
	onChange: (score: number | undefined) => void;
	size: "display" | "inline";
	value: number | undefined;
}

function ScoreSelect({ label, onChange, size, value }: ScoreSelectProps) {
	const handleChange = useCallback(
		(event: ChangeEvent<HTMLSelectElement>) => {
			const next = event.target.value;
			onChange(next === UNRATED ? undefined : Number(next));
		},
		[onChange],
	);
	return (
		<select
			aria-label={label}
			className={select({ size })}
			onChange={handleChange}
			value={value ?? UNRATED}
		>
			<option value={UNRATED}>{UNRATED_LABEL}</option>
			{SCORES.map((score) => (
				<option key={score} value={score}>
					{score}
				</option>
			))}
		</select>
	);
}

export { ScoreSelect };
