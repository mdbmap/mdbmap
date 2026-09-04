import { ScoreSelect } from "@/components/work/score-select";

interface RowScoreProps {
	airDate: string | undefined;
	label: string;
	onChange: (score: number | undefined) => void;
	value: number | undefined;
}

function RowScore({ airDate, label, onChange, value }: RowScoreProps) {
	return (
		<span className="text-ink/45 flex items-center gap-2.5 justify-self-end font-mono text-[11px]">
			<ScoreSelect
				label={label}
				onChange={onChange}
				size="inline"
				value={value}
			/>
			{airDate}
		</span>
	);
}

export { RowScore };
