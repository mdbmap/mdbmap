import { Kind, parse, print } from "graphql";
import type {
	DocumentNode,
	EnumTypeDefinitionNode,
	InputObjectTypeDefinitionNode,
	InterfaceTypeDefinitionNode,
	ObjectTypeDefinitionNode,
	ScalarTypeDefinitionNode,
	TypeNode,
	UnionTypeDefinitionNode,
} from "graphql";
import { describe, expect, it } from "vitest";

import {
	loadJson,
	parseCliArgs,
	toFileUrl,
	writeFormattedSdl,
} from "./imdb-graphql.cli.ts";
import { parseCatalog, printSdl } from "./imdb-graphql.ts";

const none: never[] = [];

const fixture = {
	AccentType: {
		args: none,
		description: none,
		enumValues: [
			{ name: "AFRICAN" },
			{ description: "Spoken Armenian", name: "ARMENIAN" },
		],
		fields: none,
		inputFields: none,
		kind: "ENUM",
		name: "AccentType",
		possibleTypes: none,
	},
	ActionLinkName: {
		args: none,
		description: "A name identifier for a given action link in a CTA.",
		enumValues: none,
		fields: none,
		inputFields: none,
		kind: "SCALAR",
		name: "ActionLinkName",
		possibleTypes: none,
	},
	AnswerItem: {
		args: none,
		description: none,
		enumValues: none,
		fields: none,
		inputFields: none,
		kind: "UNION",
		name: "AnswerItem",
		possibleTypes: ["Image", "Name", "Title"],
	},
	Cast: {
		args: none,
		description: "Cast details",
		enumValues: none,
		fields: [
			{
				args: [
					{
						defaultValue: "",
						description: "",
						kind: "Int",
						list: false,
						name: "limit",
						nullable: true,
						type: "Int",
					},
				],
				description: "",
				kind: "",
				list: true,
				name: "attributes",
				nullable: true,
				type: "CreditAttribute",
			},
			{
				args: none,
				description: "",
				kind: "",
				list: false,
				name: "category",
				nullable: false,
				type: "CreditCategory",
			},
			{
				args: none,
				description: "",
				kind: "",
				list: false,
				name: "position",
				nullable: true,
				type: "Int",
			},
			{
				args: none,
				description: "",
				kind: "",
				list: true,
				name: "watchOptions",
				nullable: false,
				type: "WatchOption",
			},
			{
				args: [
					{
						defaultValue: "{userCategory: IMDB_USERS}",
						description: "",
						kind: "INPUT_OBJECT",
						list: false,
						name: "demographicFilter",
						nullable: true,
						type: "DemographicFilter",
					},
				],
				description: "",
				kind: "",
				list: false,
				name: "histogram",
				nullable: true,
				type: "Histogram",
			},
		],
		inputFields: none,
		kind: "OBJECT",
		name: "Cast",
		possibleTypes: none,
	},
	Credit: {
		args: none,
		description: "Credit details",
		enumValues: none,
		fields: [
			{
				args: none,
				description: "Category (e.g. 'Producer').",
				kind: "",
				list: false,
				name: "category",
				nullable: false,
				type: "CreditCategory",
			},
		],
		inputFields: none,
		kind: "INTERFACE",
		name: "Credit",
		possibleTypes: ["Cast", "Crew"],
	},
	DemographicFilter: {
		args: none,
		description: none,
		enumValues: none,
		fields: none,
		inputFields: [
			{
				args: none,
				defaultValue: "",
				description: "",
				list: false,
				name: "userCategory",
				nullable: true,
				type: "UserCategory",
			},
		],
		kind: "INPUT_OBJECT",
		name: "DemographicFilter",
		possibleTypes: none,
	},
	Query: {
		args: none,
		description: "Query",
		enumValues: none,
		fields: none,
		inputFields: none,
		kind: "OBJECT",
		name: "Query",
		possibleTypes: none,
	},
	String: {
		args: none,
		description: none,
		enumValues: none,
		fields: none,
		inputFields: none,
		kind: "SCALAR",
		name: "String",
		possibleTypes: none,
	},
};

type NamedTypeDefinition =
	| EnumTypeDefinitionNode
	| InputObjectTypeDefinitionNode
	| InterfaceTypeDefinitionNode
	| ObjectTypeDefinitionNode
	| ScalarTypeDefinitionNode
	| UnionTypeDefinitionNode;

function isNamedTypeDefinition(
	definition: DocumentNode["definitions"][number],
): definition is NamedTypeDefinition {
	return (
		definition.kind === Kind.ENUM_TYPE_DEFINITION ||
		definition.kind === Kind.INPUT_OBJECT_TYPE_DEFINITION ||
		definition.kind === Kind.INTERFACE_TYPE_DEFINITION ||
		definition.kind === Kind.OBJECT_TYPE_DEFINITION ||
		definition.kind === Kind.SCALAR_TYPE_DEFINITION ||
		definition.kind === Kind.UNION_TYPE_DEFINITION
	);
}

function findNamed(
	document: DocumentNode,
	kind: NamedTypeDefinition["kind"],
	name: string,
): NamedTypeDefinition | undefined {
	for (const definition of document.definitions) {
		if (
			isNamedTypeDefinition(definition) &&
			definition.kind === kind &&
			definition.name.value === name
		) {
			return definition;
		}
	}
	return undefined;
}

function objectType(
	document: DocumentNode,
	name: string,
): ObjectTypeDefinitionNode {
	const definition = findNamed(document, Kind.OBJECT_TYPE_DEFINITION, name);
	if (definition === undefined || definition.kind !== "ObjectTypeDefinition") {
		throw new Error(`missing object type ${name}`);
	}
	return definition;
}

function interfaceType(
	document: DocumentNode,
	name: string,
): InterfaceTypeDefinitionNode {
	const definition = findNamed(document, Kind.INTERFACE_TYPE_DEFINITION, name);
	if (
		definition === undefined ||
		definition.kind !== "InterfaceTypeDefinition"
	) {
		throw new Error(`missing interface type ${name}`);
	}
	return definition;
}

function unionType(
	document: DocumentNode,
	name: string,
): UnionTypeDefinitionNode {
	const definition = findNamed(document, Kind.UNION_TYPE_DEFINITION, name);
	if (definition === undefined || definition.kind !== "UnionTypeDefinition") {
		throw new Error(`missing union type ${name}`);
	}
	return definition;
}

function enumType(
	document: DocumentNode,
	name: string,
): EnumTypeDefinitionNode {
	const definition = findNamed(document, Kind.ENUM_TYPE_DEFINITION, name);
	if (definition === undefined || definition.kind !== "EnumTypeDefinition") {
		throw new Error(`missing enum type ${name}`);
	}
	return definition;
}

function inputType(
	document: DocumentNode,
	name: string,
): InputObjectTypeDefinitionNode {
	const definition = findNamed(
		document,
		Kind.INPUT_OBJECT_TYPE_DEFINITION,
		name,
	);
	if (
		definition === undefined ||
		definition.kind !== "InputObjectTypeDefinition"
	) {
		throw new Error(`missing input type ${name}`);
	}
	return definition;
}

function scalarType(
	document: DocumentNode,
	name: string,
): ScalarTypeDefinitionNode | undefined {
	const definition = findNamed(document, Kind.SCALAR_TYPE_DEFINITION, name);
	if (definition === undefined || definition.kind !== "ScalarTypeDefinition") {
		return undefined;
	}
	return definition;
}

function fieldOf(
	type: ObjectTypeDefinitionNode | InterfaceTypeDefinitionNode,
	name: string,
) {
	const field = type.fields?.find((entry) => entry.name.value === name);
	if (field === undefined) {
		throw new Error(`missing field ${name}`);
	}
	return field;
}

function printedType(type: TypeNode): string {
	return print(type);
}

function requestHref(input: RequestInfo | URL): string {
	if (typeof input === "string") {
		return input;
	}
	if (input instanceof URL) {
		return input.href;
	}
	return input.url;
}

describe("imdb graphql catalog", () => {
	const catalog = parseCatalog(fixture);
	const sdl = printSdl(catalog);
	const document = parse(sdl);

	it("inverts interface possibleTypes onto objects", () => {
		const cast = catalog.types.find(
			(type) => type.kind === "OBJECT" && type.name === "Cast",
		);
		expect(cast?.kind === "OBJECT" ? cast.implements : undefined).toEqual([
			"Credit",
		]);
		expect(
			objectType(document, "Cast").interfaces?.map((entry) => entry.name.value),
		).toEqual(["Credit"]);
	});

	it("prints wrapping, args, and defaults", () => {
		const cast = objectType(document, "Cast");
		expect(printedType(fieldOf(cast, "attributes").type)).toBe(
			"[CreditAttribute]",
		);
		expect(printedType(fieldOf(cast, "category").type)).toBe("CreditCategory!");
		expect(printedType(fieldOf(cast, "position").type)).toBe("Int");
		expect(printedType(fieldOf(cast, "watchOptions").type)).toBe(
			"[WatchOption]!",
		);
		expect(fieldOf(cast, "attributes").arguments?.[0]?.name.value).toBe(
			"limit",
		);
		const defaultValue = fieldOf(cast, "histogram").arguments?.[0]
			?.defaultValue;
		if (defaultValue === undefined) {
			throw new Error("missing histogram default");
		}
		expect(defaultValue.kind).toBe(Kind.OBJECT);
		expect(print(defaultValue)).toBe("{ userCategory: IMDB_USERS }");
	});

	it("prints interface, union, enum, input, and custom scalar", () => {
		expect(interfaceType(document, "Credit").fields?.[0]?.name.value).toBe(
			"category",
		);
		expect(sdl).not.toContain("possibleTypes");
		expect(
			unionType(document, "AnswerItem").types?.map((entry) => entry.name.value),
		).toEqual(["Image", "Name", "Title"]);
		expect(
			enumType(document, "AccentType").values?.map((entry) => entry.name.value),
		).toEqual(["AFRICAN", "ARMENIAN"]);
		expect(
			inputType(document, "DemographicFilter").fields?.[0]?.name.value,
		).toBe("userCategory");
		expect(scalarType(document, "ActionLinkName")?.name.value).toBe(
			"ActionLinkName",
		);
	});

	it("omits built-in scalars and empty-array descriptions", () => {
		expect(scalarType(document, "String")).toBeUndefined();
		const answer = unionType(document, "AnswerItem");
		expect(answer.description).toBeUndefined();
		expect(sdl.startsWith("schema {\n")).toBe(true);
	});

	it("rejects a catalog without Query", () => {
		const withoutQuery = Object.fromEntries(
			Object.entries(fixture).filter(([name]) => name !== "Query"),
		);
		expect(() => parseCatalog(withoutQuery)).toThrow(
			"catalog is missing OBJECT Query",
		);
	});
});

describe("imdb graphql cli", () => {
	it("parses flags and defaults", () => {
		expect(parseCliArgs([])).toEqual({
			inPath:
				"https://raw.githubusercontent.com/MiM-MiM/MyMovieGraphQLPy/refs/heads/master/MyMovieGraphQL/data/INTROSPECTION.json",
			outPath: "schemas/schema.graphql",
		});
		expect(parseCliArgs(["--in", "dump.json", "--out", "out.graphql"])).toEqual(
			{
				inPath: "dump.json",
				outPath: "out.graphql",
			},
		);
		expect(() => parseCliArgs(["--in"])).toThrow("missing value for --in");
		expect(() => parseCliArgs(["--out"])).toThrow("missing value for --out");
		expect(() => parseCliArgs(["--wat"])).toThrow("unknown argument: --wat");
	});

	it("turns relative and absolute paths into file URLs", () => {
		expect(toFileUrl("file:///tmp/a.json", "/cwd")).toBe("file:///tmp/a.json");
		expect(toFileUrl("/tmp/a.json", "/cwd")).toBe("file:///tmp/a.json");
		expect(toFileUrl("dump.json", "/cwd")).toBe("file:///cwd/dump.json");
	});

	it("loadJson returns JSON and fails on a non-ok fetch", async () => {
		const originalFetch = globalThis.fetch;
		const calls: string[] = [];
		const stub: typeof fetch = async (input) => {
			const href = requestHref(input);
			calls.push(href);
			if (href === "https://example.test/missing.json") {
				const missing = await Promise.resolve(
					new Response("", { status: 404 }),
				);
				return missing;
			}
			return Response.json({ Query: { kind: "OBJECT" } });
		};
		globalThis.fetch = stub;
		try {
			await expect(
				loadJson("https://example.test/missing.json", "/"),
			).rejects.toThrow("failed to fetch introspection JSON (404)");
			await expect(
				loadJson("https://example.test/ok.json", "/"),
			).resolves.toEqual({ Query: { kind: "OBJECT" } });
			expect(calls).toEqual([
				"https://example.test/missing.json",
				"https://example.test/ok.json",
			]);
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	it("writeFormattedSdl throws when oxfmt exits non-zero", async () => {
		let wrote: { data: string; path: string } | undefined;
		await expect(
			writeFormattedSdl(
				{
					spawn: () => ({ exited: Promise.resolve(1) }),
					write: async (path, data) => {
						wrote = { data, path };
						await Promise.resolve();
					},
				},
				"out.graphql",
				"schema { query: Query }",
			),
		).rejects.toThrow("oxfmt exited 1");
		expect(wrote).toEqual({
			data: "schema { query: Query }",
			path: "out.graphql",
		});
	});
});
