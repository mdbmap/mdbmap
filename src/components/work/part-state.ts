import { create } from "zustand";

import type { PartView } from "@/orpc/schema";

// Selected part is shared across subtrees: the Episodes list (#11) drives it and
// the sidebar This-part panel (#13) reads it. A store keeps the two in sync with
// no provider. `undefined` means "untouched" and resolves to the last part, so
// the server and the first client render agree without an effect.
interface PartSelectionStore {
	selectPart: (index: number) => void;
	selectedIndex: number | undefined;
}

const usePartSelectionStore = create<PartSelectionStore>((set) => ({
	selectPart: (index) => {
		set({ selectedIndex: index });
	},
	selectedIndex: undefined,
}));

interface SelectedPart {
	selectPart: (index: number) => void;
	selectedIndex: number;
	selectedPart: PartView | undefined;
}

// `undefined` resolves to the last part (newest cour); an explicit choice is
// clamped so a selection carried over from a longer work never points past the end.
function resolveSelectedIndex(stored: number | undefined, partCount: number): number {
	const lastIndex = Math.max(0, partCount - 1);
	return stored === undefined ? lastIndex : Math.min(Math.max(stored, 0), lastIndex);
}

function useSelectedPart(parts: PartView[]): SelectedPart {
	const stored = usePartSelectionStore((state) => state.selectedIndex);
	const selectPart = usePartSelectionStore((state) => state.selectPart);
	const selectedIndex = resolveSelectedIndex(stored, parts.length);
	return { selectPart, selectedIndex, selectedPart: parts[selectedIndex] };
}

export { resolveSelectedIndex, usePartSelectionStore, useSelectedPart };
