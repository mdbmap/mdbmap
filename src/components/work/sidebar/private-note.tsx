import { useCallback } from "react";
import type { FocusEvent } from "react";

const NOTE_LABEL = "Private note";
const NOTE_MAX = 4000;

interface PrivateNoteProps {
	continuityId: string;
	note: string | undefined;
	onSave: (body: string) => void;
}

function PrivateNote({ continuityId, note, onSave }: PrivateNoteProps) {
	const onBlur = useCallback(
		(event: FocusEvent<HTMLTextAreaElement>) => {
			onSave(event.currentTarget.value);
		},
		[onSave],
	);
	return (
		<label className="mt-4 block">
			<span className="text-ink/50 font-mono text-[11px] uppercase">
				{NOTE_LABEL}
			</span>
			<textarea
				aria-label={NOTE_LABEL}
				className="border-line text-ink/90 mt-1.5 w-full resize-y border bg-transparent p-2 font-serif text-sm"
				defaultValue={note ?? ""}
				key={continuityId}
				maxLength={NOTE_MAX}
				onBlur={onBlur}
				rows={3}
			/>
		</label>
	);
}

export { PrivateNote };
