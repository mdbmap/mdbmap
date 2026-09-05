import { describe, expect, it } from "vitest";

import {
	DEFAULT_THEME,
	isTheme,
	nextTheme,
	THEME_STORAGE_KEY,
	themeInitScript,
} from "./theme.ts";

describe("theme", () => {
	it("guards arbitrary values", () => {
		expect(isTheme("dark")).toBe(true);
		expect(isTheme("light")).toBe(true);
		expect(isTheme("solarized")).toBe(false);
		expect(isTheme(undefined)).toBe(false);
	});

	it("toggles between the two themes and round-trips", () => {
		expect(nextTheme("light")).toBe("dark");
		expect(nextTheme("dark")).toBe("light");
		expect(nextTheme(nextTheme(DEFAULT_THEME))).toBe(DEFAULT_THEME);
	});

	it("bakes the storage key and default into the pre-hydration script", () => {
		expect(themeInitScript).toContain(THEME_STORAGE_KEY);
		expect(themeInitScript).toContain(DEFAULT_THEME);
	});
});
