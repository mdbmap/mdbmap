import { defineConfig } from "vitest/config";

const src = `${import.meta.dirname}/src`;

export default defineConfig({
	resolve: {
		alias: {
			"#": `${src}/generated`,
			"@": src,
		},
	},
	test: {
		coverage: {
			provider: "v8",
		},
		passWithNoTests: true,
	},
});
