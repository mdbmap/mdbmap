import { useNavigate, useSearch } from "@tanstack/react-router";
import { useCallback, useState } from "react";

import { Home } from "@/components/home";

export function HomeRoute() {
	const { signin } = useSearch({ from: "/" });
	const navigate = useNavigate({ from: "/" });
	const [manualOpen, setManualOpen] = useState(false);
	const signinFromUrl = signin === true;
	const signinOpen = signinFromUrl || manualOpen;

	const handleSigninOpenChange = useCallback(
		(open: boolean) => {
			setManualOpen(open);
			if (!open && signinFromUrl) {
				void navigate({
					replace: true,
					search: (previous) => {
						const next = { ...previous };
						delete next.signin;
						return next;
					},
				});
			}
		},
		[navigate, signinFromUrl],
	);

	return (
		<Home onSigninOpenChange={handleSigninOpenChange} signinOpen={signinOpen} />
	);
}
