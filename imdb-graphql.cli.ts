import { parseCatalog, printSdl } from "./imdb-graphql.ts";

const defaultIntrospectionUrl =
	"https://raw.githubusercontent.com/MiM-MiM/MyMovieGraphQLPy/refs/heads/master/MyMovieGraphQL/data/INTROSPECTION.json";
const defaultOutPath = "schemas/schema.graphql";

interface CliOptions {
	readonly inPath: string;
	readonly outPath: string;
}

interface RuntimeProcess {
	readonly argv: readonly unknown[];
	cwd: () => unknown;
}

interface RuntimeBun {
	spawn: (
		commands: string[],
		options: { stderr: "inherit"; stdout: "inherit" },
	) => { exited: Promise<unknown> };
	write: (path: string, data: string) => Promise<unknown>;
}

function isRuntimeProcess(value: unknown): value is RuntimeProcess {
	if (!value || typeof value !== "object") {
		return false;
	}
	return (
		Array.isArray(Reflect.get(value, "argv")) &&
		typeof Reflect.get(value, "cwd") === "function"
	);
}

function isRuntimeBun(value: unknown): value is RuntimeBun {
	if (!value || typeof value !== "object") {
		return false;
	}
	return (
		typeof Reflect.get(value, "spawn") === "function" &&
		typeof Reflect.get(value, "write") === "function"
	);
}

function parseCliArgs(args: readonly string[]): CliOptions {
	let inPath = defaultIntrospectionUrl;
	let outPath = defaultOutPath;
	for (let index = 0; index < args.length; index += 1) {
		const flag = args[index];
		if (flag === "--in") {
			const value = args[index + 1];
			if (value === undefined) {
				throw new Error("missing value for --in");
			}
			inPath = value;
			index += 1;
			continue;
		}
		if (flag === "--out") {
			const value = args[index + 1];
			if (value === undefined) {
				throw new Error("missing value for --out");
			}
			outPath = value;
			index += 1;
			continue;
		}
		throw new Error(`unknown argument: ${flag ?? ""}`);
	}
	return { inPath, outPath };
}

function isHttpUrl(value: string): boolean {
	return value.startsWith("https://") || value.startsWith("http://");
}

function processArgvAndCwd(): { argv: readonly string[]; cwd: string } {
	const candidate: unknown = Reflect.get(globalThis, "process");
	if (!isRuntimeProcess(candidate)) {
		throw new TypeError("process is required");
	}
	const args: string[] = [];
	for (const value of candidate.argv.slice(2)) {
		if (typeof value !== "string") {
			throw new TypeError("process.argv is required");
		}
		args.push(value);
	}
	const cwd = candidate.cwd();
	if (typeof cwd !== "string") {
		throw new TypeError("process.cwd is required");
	}
	return { argv: args, cwd };
}

function bunRuntime(): RuntimeBun {
	const candidate: unknown = Reflect.get(globalThis, "Bun");
	if (!isRuntimeBun(candidate)) {
		throw new TypeError("Bun runtime required");
	}
	return candidate;
}

function toFileUrl(path: string, cwd: string): string {
	if (path.startsWith("file:")) {
		return path;
	}
	const absolute = path.startsWith("/") ? path : `${cwd}/${path}`;
	return `file://${absolute}`;
}

async function loadJson(inPath: string, cwd: string): Promise<unknown> {
	const source = isHttpUrl(inPath) ? inPath : toFileUrl(inPath, cwd);
	const response = await fetch(source);
	if (!response.ok) {
		throw new Error(
			`failed to fetch introspection JSON (${String(response.status)})`,
		);
	}
	return response.json();
}

async function main(args: readonly string[], cwd: string): Promise<void> {
	const options = parseCliArgs(args);
	const bun = bunRuntime();
	const sdl = printSdl(parseCatalog(await loadJson(options.inPath, cwd)));
	await bun.write(options.outPath, sdl);
	const code = await bun.spawn(["bunx", "oxfmt", options.outPath], {
		stderr: "inherit",
		stdout: "inherit",
	}).exited;
	if (code !== 0) {
		throw new Error(`oxfmt exited ${String(code)}`);
	}
}

const { argv, cwd } = processArgvAndCwd();
void main(argv, cwd);

export default main;
