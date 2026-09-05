import { Moon, Sun } from "lucide-react";
import { useCallback, useSyncExternalStore } from "react";
import { tv } from "tailwind-variants";

import {
	getServerTheme,
	nextTheme,
	readAppliedTheme,
	setAppliedTheme,
	subscribeTheme,
} from "@/lib/design/theme";

const toggle = tv({
	base: "text-ink/50 inline-flex cursor-pointer items-center gap-2 border-none bg-transparent font-mono text-xs",
});

export function ThemeToggle() {
	const theme = useSyncExternalStore(
		subscribeTheme,
		readAppliedTheme,
		getServerTheme,
	);

	const handleToggle = useCallback(() => {
		setAppliedTheme(nextTheme(theme));
	}, [theme]);

	const target = theme === "dark" ? "light" : "dark";
	const Icon = theme === "dark" ? Sun : Moon;

	return (
		<button
			type="button"
			aria-label={`Switch to ${target} theme`}
			className={toggle()}
			onClick={handleToggle}
		>
			<Icon aria-hidden size={14} />
			<span className="capitalize">{target}</span>
		</button>
	);
}
