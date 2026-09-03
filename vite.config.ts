import { cloudflare } from "@cloudflare/vite-plugin";
import { paraglideVitePlugin } from "@inlang/paraglide-js";
import babel from "@rolldown/plugin-babel";
import tailwindcss from "@tailwindcss/vite";
import { devtools } from "@tanstack/devtools-vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact, { reactCompilerPreset } from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const config = defineConfig({
	plugins: [
		devtools({ removeDevtoolsOnBuild: true }),
		paraglideVitePlugin({
			emitTsDeclarations: true,
			outdir: "./src/generated/paraglide",
			project: "./i18n.inlang",
			strategy: ["url", "baseLocale"],
		}),
		cloudflare({ viteEnvironment: { name: "ssr" } }),
		tailwindcss(),
		tanstackStart({
			router: { generatedRouteTree: "generated/routeTree.ts" },
		}),
		viteReact(),
		babel({ presets: [reactCompilerPreset()] }),
	],
	resolve: { tsconfigPaths: true },
	server: {
		cors: true,
		port: 3000,
	},
});

export default config;
