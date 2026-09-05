import { useCallback } from "react";
import { create } from "zustand";

import type { PresentationOrderSlug } from "@/db/engine-schema";
import type { WorkBlock } from "@/orpc/schema";

// Selected part is shared across subtrees: the Episodes list (#11) drives it and
// the sidebar This-part panel (#13) reads it. A store keeps the two in sync with
// no provider. `undefined` means "untouched" and resolves to the last part, so
// the server and the first client render agree without an effect.
interface PartSelectionStore {
	selectKey: (key: string) => void;
	selectedKey: string | undefined;
}

const usePartSelectionStore = create<PartSelectionStore>((set) => ({
	selectKey: (key) => {
		set({ selectedKey: key });
	},
	selectedKey: undefined,
}));

interface SelectedPart {
	selectPart: (index: number) => void;
	selectedIndex: number;
	selectedPart: WorkBlock | undefined;
}

// `undefined` resolves to the last block; an explicit key is kept across order
// changes and falls back to the last block when the key is absent from the list.
function resolveSelectedIndex(
	storedKey: string | undefined,
	parts: WorkBlock[],
): number {
	if (parts.length === 0) {
		return 0;
	}
	if (storedKey !== undefined) {
		const index = parts.findIndex(
			(part) => part.rateableUnit.key === storedKey,
		);
		if (index !== -1) {
			return index;
		}
	}
	return parts.length - 1;
}

interface WorkGetSelection {
	locale?: string | undefined;
	order?: PresentationOrderSlug | undefined;
	proposalId?: number | undefined;
}

const DEFAULT_VIEWER_LOCALE = "en";

const viewerLocale = (explicit?: string): string => {
	if (explicit !== undefined && explicit.trim() !== "") {
		return explicit.trim();
	}
	if (typeof document !== "undefined") {
		const lang = document.documentElement.lang.trim();
		if (lang !== "") {
			return lang;
		}
	}
	return DEFAULT_VIEWER_LOCALE;
};

const workGetInput = (
	continuityId: string,
	selection?: PresentationOrderSlug | WorkGetSelection,
) => {
	if (selection === undefined) {
		return { continuityId, locale: viewerLocale() };
	}
	if (typeof selection === "string") {
		return { continuityId, locale: viewerLocale(), order: selection };
	}
	return {
		continuityId,
		locale: viewerLocale(selection.locale),
		...(selection.order === undefined ? {} : { order: selection.order }),
		...(selection.proposalId === undefined
			? {}
			: { proposalId: selection.proposalId }),
	};
};

function useSelectedPart(parts: WorkBlock[]): SelectedPart {
	const storedKey = usePartSelectionStore((state) => state.selectedKey);
	const selectKey = usePartSelectionStore((state) => state.selectKey);
	const selectPart = useCallback(
		(index: number) => {
			const part = parts[index];
			if (part !== undefined) {
				selectKey(part.rateableUnit.key);
			}
		},
		[parts, selectKey],
	);
	const selectedIndex = resolveSelectedIndex(storedKey, parts);
	return { selectPart, selectedIndex, selectedPart: parts[selectedIndex] };
}

export {
	resolveSelectedIndex,
	usePartSelectionStore,
	useSelectedPart,
	viewerLocale,
	workGetInput,
};
export type { WorkGetSelection };
