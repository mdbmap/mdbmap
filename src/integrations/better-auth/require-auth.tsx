import { useCallback, useState } from "react";
import type { ReactNode } from "react";

import { authClient } from "@/lib/auth-client";

import { AuthDialog } from "./auth-dialog";

type AuthGate = "run" | "prompt" | "wait";

const SIGN_IN = "Sign in";

const authGateFor = (isPending: boolean, signedIn: boolean): AuthGate => {
	if (isPending) {
		return "wait";
	}
	if (!signedIn) {
		return "prompt";
	}
	return "run";
};

interface RequireAuth {
	authDialog: ReactNode;
	requireAuth: (action: () => void) => void;
}

function useRequireAuth(): RequireAuth {
	const { data: session, isPending } = authClient.useSession();
	const signedIn = session?.user !== undefined;
	const [authOpen, setAuthOpen] = useState(false);
	const gate = authGateFor(isPending, signedIn);

	const requireAuth = useCallback(
		(action: () => void) => {
			switch (authGateFor(isPending, signedIn)) {
				case "wait": {
					return;
				}
				case "prompt": {
					setAuthOpen(true);
					return;
				}
				case "run": {
					action();
				}
			}
		},
		[isPending, signedIn],
	);

	const authDialog =
		gate === "prompt" ? (
			<AuthDialog
				isOpen={authOpen}
				label={SIGN_IN}
				onOpenChange={setAuthOpen}
				variant="hidden"
			/>
		) : undefined;

	return { authDialog, requireAuth };
}

export { authGateFor, useRequireAuth };
export type { AuthGate };
