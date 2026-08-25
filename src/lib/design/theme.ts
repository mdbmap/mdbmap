const THEME_STORAGE_KEY = "mdbmap-theme";

const THEMES = ["light", "dark"] as const;
type Theme = (typeof THEMES)[number];

const DEFAULT_THEME: Theme = "light";

function isTheme(value: unknown): value is Theme {
	return value === "light" || value === "dark";
}

function nextTheme(theme: Theme): Theme {
	return theme === "dark" ? "light" : "dark";
}

const listeners = new Set<() => void>();

function readAppliedTheme(): Theme {
	const applied = document.documentElement.dataset["theme"];
	return isTheme(applied) ? applied : DEFAULT_THEME;
}

function setAppliedTheme(theme: Theme): void {
	document.documentElement.dataset["theme"] = theme;
	try {
		localStorage.setItem(THEME_STORAGE_KEY, theme);
	} catch {
		// storage may be unavailable (private mode, blocked cookies)
	}
	for (const listener of listeners) {
		listener();
	}
}

function subscribeTheme(listener: () => void): () => void {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}

const getServerTheme = (): Theme => DEFAULT_THEME;

// Runs before hydration to apply the stored theme and avoid a flash of light.
const themeInitScript = `(() => {
	try {
		const stored = localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)});
		const theme = stored === "light" || stored === "dark" ? stored : ${JSON.stringify(DEFAULT_THEME)};
		document.documentElement.dataset.theme = theme;
	} catch {
		document.documentElement.dataset.theme = ${JSON.stringify(DEFAULT_THEME)};
	}
})();`;

export {
	DEFAULT_THEME,
	getServerTheme,
	isTheme,
	nextTheme,
	readAppliedTheme,
	setAppliedTheme,
	subscribeTheme,
	THEME_STORAGE_KEY,
	themeInitScript,
	type Theme,
};
