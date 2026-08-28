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

function objectType(
	document: DocumentNode,
	name: string,
): ObjectTypeDefinitionNode {
	for (const definition of document.definitions) {
		if (
			definition.kind === Kind.OBJECT_TYPE_DEFINITION &&
			definition.name.value === name
		) {
			return definition;
		}
	}
	throw new Error(`missing object type ${name}`);
}

function interfaceType(
	document: DocumentNode,
	name: string,
): InterfaceTypeDefinitionNode {
	for (const definition of document.definitions) {
		if (
			definition.kind === Kind.INTERFACE_TYPE_DEFINITION &&
			definition.name.value === name
		) {
			return definition;
		}
	}
	throw new Error(`missing interface type ${name}`);
}

function unionType(
	document: DocumentNode,
	name: string,
): UnionTypeDefinitionNode {
	for (const definition of document.definitions) {
		if (
			definition.kind === Kind.UNION_TYPE_DEFINITION &&
			definition.name.value === name
		) {
			return definition;
		}
	}
	throw new Error(`missing union type ${name}`);
}

function enumType(
	document: DocumentNode,
	name: string,
): EnumTypeDefinitionNode {
	for (const definition of document.definitions) {
		if (
			definition.kind === Kind.ENUM_TYPE_DEFINITION &&
			definition.name.value === name
		) {
			return definition;
		}
	}
	throw new Error(`missing enum type ${name}`);
}

function inputType(
	document: DocumentNode,
	name: string,
): InputObjectTypeDefinitionNode {
	for (const definition of document.definitions) {
		if (
			definition.kind === Kind.INPUT_OBJECT_TYPE_DEFINITION &&
			definition.name.value === name
		) {
			return definition;
		}
	}
	throw new Error(`missing input type ${name}`);
}

function scalarType(
	document: DocumentNode,
	name: string,
): ScalarTypeDefinitionNode | undefined {
	for (const definition of document.definitions) {
		if (
			definition.kind === Kind.SCALAR_TYPE_DEFINITION &&
			definition.name.value === name
		) {
			return definition;
		}
	}
	return undefined;
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
