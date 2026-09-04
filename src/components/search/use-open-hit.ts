import { useMutation } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useCallback, useState } from "react";

import { orpc } from "@/orpc/client";
import type { SearchHit } from "@/orpc/schema";

import { applyOpenResult } from "./apply-open-result";
import { ERROR_BODY, openInputFor } from "./open-hit";
import type { OpenHitState } from "./open-hit";

interface OpenHitControls {
	onOpen: () => void;
	state: OpenHitState;
}

const useOpenHit = (hit: SearchHit): OpenHitControls => {
	const navigate = useNavigate();
	const [state, setState] = useState<OpenHitState>({ kind: "idle" });
	const mutation = useMutation(
		orpc.work.open.mutationOptions({
			onError: () => {
				setState({ kind: "error", message: ERROR_BODY });
			},
			onSuccess: (result) => {
				applyOpenResult(
					result,
					(args) => {
						void navigate(args);
					},
					setState,
				);
			},
		}),
	);
	const { mutate } = mutation;
	const onOpen = useCallback(() => {
		setState({ kind: "opening" });
		mutate(openInputFor(hit.catalogue, hit.mediaKind));
	}, [hit.catalogue, hit.mediaKind, mutate]);
	return { onOpen, state };
};

export { useOpenHit };
export type { OpenHitControls };
