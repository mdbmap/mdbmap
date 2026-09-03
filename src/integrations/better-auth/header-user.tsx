import { useCallback } from "react";
import { tv } from "tailwind-variants";

import { authClient } from "@/lib/auth-client";

import { AuthDialog } from "./auth-dialog.tsx";

const pending = tv({
	base: "border-line bg-ink/10 size-7 animate-pulse border",
});

const sessionRow = tv({
	base: "flex items-center gap-2.5",
});

const avatar = tv({
	base: "border-line bg-no-still text-ink/70 flex size-7 items-center justify-center border font-mono text-[11px]",
});

const signOutButton = tv({
	base: "text-ink/50 hover:text-accent inline-flex cursor-pointer items-center gap-2 border-none bg-transparent font-mono text-xs",
});

const SIGN_OUT = "Sign out";

function userInitial(name: string | undefined): string {
	const trimmed = name?.trim();
	if (trimmed === undefined || trimmed.length === 0) {
		return "?";
	}
	return trimmed.charAt(0).toUpperCase();
}

function BetterAuthHeader() {
	const { data: session, isPending } = authClient.useSession();

	const handleSignOut = useCallback(() => {
		void authClient.signOut();
	}, []);

	if (isPending) {
		return <div aria-hidden className={pending()} />;
	}

	const user = session?.user;
	if (user === undefined) {
		return <AuthDialog />;
	}

	const { image } = user;
	const hasImage = typeof image === "string" && image.length > 0;

	return (
		<div className={sessionRow()}>
			{hasImage ? (
				<img
					alt=""
					className="border-line size-7 border object-cover"
					src={image}
				/>
			) : (
				<div aria-hidden className={avatar()}>
					{userInitial(user.name)}
				</div>
			)}
			<span className="text-ink/70 max-w-[10rem] truncate font-mono text-xs">
				{user.name}
			</span>
			<button className={signOutButton()} onClick={handleSignOut} type="button">
				{SIGN_OUT}
			</button>
		</div>
	);
}

export { BetterAuthHeader };
