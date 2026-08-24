import type { Config } from "stylelint";

export default {
	extends: [
		"stylelint-config-recommended",
		"stylelint-config-clean-order",
		"@dreamsicle.io/stylelint-config-tailwindcss",
	],
	ignoreFiles: ["!src/**/*.css"],
} satisfies Config;
