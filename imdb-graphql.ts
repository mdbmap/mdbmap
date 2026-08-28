import { parse } from "graphql";
import { z } from "zod";

const builtInScalars = new Set(["Boolean", "Float", "ID", "Int", "String"]);

const emptyDescription = z.tuple([]);
const typeDescriptionSchema = z.union([z.string(), emptyDescription]);

const wrappedTypeFields = {
	list: z.boolean(),
	nullable: z.boolean(),
	type: z.string(),
};

const argumentSchema = z.object({
	defaultValue: z.string(),
	description: z.string(),
	kind: z.string(),
	name: z.string(),
	...wrappedTypeFields,
});

const fieldSchema = z.object({
	args: z.array(argumentSchema),
	description: z.string(),
	kind: z.string(),
	name: z.string(),
	...wrappedTypeFields,
});

const inputFieldSchema = z.object({
	args: z.array(z.unknown()),
	defaultValue: z.string(),
	description: z.string(),
	name: z.string(),
	...wrappedTypeFields,
});

const enumValueSchema = z.object({
	description: z.string().nullish(),
	name: z.string(),
});

const typeRecordFields = {
	args: z.array(z.unknown()),
	description: typeDescriptionSchema,
	enumValues: z.array(enumValueSchema),
	fields: z.array(fieldSchema),
	inputFields: z.array(inputFieldSchema),
	name: z.string(),
	possibleTypes: z.array(z.string()),
};

const typeRecordSchema = z.discriminatedUnion("kind", [
	z.object({ kind: z.literal("ENUM"), ...typeRecordFields }),
	z.object({ kind: z.literal("INPUT_OBJECT"), ...typeRecordFields }),
	z.object({ kind: z.literal("INTERFACE"), ...typeRecordFields }),
	z.object({ kind: z.literal("OBJECT"), ...typeRecordFields }),
	z.object({ kind: z.literal("SCALAR"), ...typeRecordFields }),
	z.object({ kind: z.literal("UNION"), ...typeRecordFields }),
]);

const catalogJsonSchema = z.record(z.string(), typeRecordSchema);

type WireCatalog = z.infer<typeof catalogJsonSchema>;
type WireTypeRecord = WireCatalog[string];
type WireArgument = z.infer<typeof argumentSchema>;
type WireInputField = z.infer<typeof inputFieldSchema>;
type WireField = z.infer<typeof fieldSchema>;

interface TypeRef {
	readonly list: boolean;
	readonly name: string;
	readonly nullable: boolean;
}

interface Arg {
	readonly defaultValue?: string;
	readonly description?: string;
	readonly name: string;
	readonly type: TypeRef;
}

interface Field {
	readonly args: readonly Arg[];
	readonly description?: string;
	readonly name: string;
	readonly type: TypeRef;
}

interface EnumValue {
	readonly description?: string;
	readonly name: string;
}

type CatalogType =
	| {
			readonly description?: string;
			readonly kind: "ENUM";
			readonly name: string;
			readonly values: readonly EnumValue[];
	  }
	| {
			readonly description?: string;
			readonly inputFields: readonly Arg[];
			readonly kind: "INPUT_OBJECT";
			readonly name: string;
	  }
	| {
			readonly description?: string;
			readonly fields: readonly Field[];
			readonly kind: "INTERFACE";
			readonly name: string;
	  }
	| {
			readonly description?: string;
			readonly fields: readonly Field[];
			readonly implements: readonly string[];
			readonly kind: "OBJECT";
			readonly name: string;
	  }
	| {
			readonly description?: string;
			readonly kind: "SCALAR";
			readonly name: string;
	  }
	| {
			readonly description?: string;
			readonly kind: "UNION";
			readonly members: readonly string[];
			readonly name: string;
	  };

interface Catalog {
	readonly types: readonly CatalogType[];
}

function descriptionFields(
	value: string | null | undefined | readonly unknown[],
): { readonly description: string } | Record<PropertyKey, never> {
	if (typeof value !== "string" || value === "") {
		return {};
	}
	return { description: value };
}

function toTypeRef(wrap: {
	list: boolean;
	nullable: boolean;
	type: string;
}): TypeRef {
	return { list: wrap.list, name: wrap.type, nullable: wrap.nullable };
}

function toArg(raw: WireArgument | WireInputField): Arg {
	return {
		name: raw.name,
		type: toTypeRef(raw),
		...(raw.defaultValue === "" ? {} : { defaultValue: raw.defaultValue }),
		...descriptionFields(raw.description),
	};
}

function toField(raw: WireField): Field {
	return {
		args: raw.args.map((argument) => toArg(argument)),
		name: raw.name,
		type: toTypeRef(raw),
		...descriptionFields(raw.description),
	};
}

function sortNames(names: readonly string[]): readonly string[] {
	const sorted = [...names];
	sorted.sort((left, right) => left.localeCompare(right));
	return sorted;
}

function invertImplements(
	records: Iterable<WireTypeRecord>,
): Map<string, string[]> {
	const implementsByObject = new Map<string, string[]>();
	for (const record of records) {
		if (record.kind !== "INTERFACE") {
			continue;
		}
		for (const objectName of record.possibleTypes) {
			const implemented = implementsByObject.get(objectName);
			if (implemented === undefined) {
				implementsByObject.set(objectName, [record.name]);
				continue;
			}
			implemented.push(record.name);
		}
	}
	return implementsByObject;
}

function toCatalogType(
	record: WireTypeRecord,
	implemented: readonly string[],
): CatalogType {
	const description = descriptionFields(record.description);
	switch (record.kind) {
		case "ENUM": {
			return {
				kind: "ENUM",
				name: record.name,
				values: record.enumValues.map((value) => ({
					name: value.name,
					...descriptionFields(value.description),
				})),
				...description,
			};
		}
		case "INPUT_OBJECT": {
			return {
				inputFields: record.inputFields.map((inputField) => toArg(inputField)),
				kind: "INPUT_OBJECT",
				name: record.name,
				...description,
			};
		}
		case "INTERFACE": {
			return {
				fields: record.fields.map((field) => toField(field)),
				kind: "INTERFACE",
				name: record.name,
				...description,
			};
		}
		case "OBJECT": {
			return {
				fields: record.fields.map((field) => toField(field)),
				implements: sortNames(implemented),
				kind: "OBJECT",
				name: record.name,
				...description,
			};
		}
		case "SCALAR": {
			return {
				kind: "SCALAR",
				name: record.name,
				...description,
			};
		}
		case "UNION": {
			return {
				kind: "UNION",
				members: record.possibleTypes,
				name: record.name,
				...description,
			};
		}
		default: {
			const exhaustive: never = record;
			return exhaustive;
		}
	}
}

function parseCatalog(json: unknown): Catalog {
	const records = catalogJsonSchema.parse(json);
	const values = Object.values(records);
	const hasQuery = values.some(
		(record) => record.kind === "OBJECT" && record.name === "Query",
	);
	if (!hasQuery) {
		throw new Error("catalog is missing OBJECT Query");
	}
	const implementsByObject = invertImplements(values);
	const types = values.map((record) =>
		toCatalogType(record, implementsByObject.get(record.name) ?? []),
	);
	types.sort((left, right) => left.name.localeCompare(right.name));
	return { types };
}

function formatBlockString(value: string): string {
	return `"""\n${value.replaceAll('"""', String.raw`\"""`)}\n"""`;
}

function printDescription(holder: { readonly description?: string }): string {
	if (holder.description === undefined) {
		return "";
	}
	return `${formatBlockString(holder.description)}\n`;
}

function printTypeRef(type: TypeRef): string {
	const named = type.list ? `[${type.name}]` : type.name;
	return type.nullable ? named : `${named}!`;
}

function printInputValue(arg: Arg): string {
	const defaultClause =
		arg.defaultValue === undefined ? "" : ` = ${arg.defaultValue}`;
	return `${printDescription(arg)}${arg.name}: ${printTypeRef(arg.type)}${defaultClause}`;
}

function printArgList(args: readonly Arg[]): string {
	if (args.length === 0) {
		return "";
	}
	return `(${args.map((argument) => printInputValue(argument)).join(", ")})`;
}

function printField(field: Field): string {
	return `${printDescription(field)}${field.name}${printArgList(field.args)}: ${printTypeRef(field.type)}`;
}

function printBlock(lines: readonly string[]): string {
	if (lines.length === 0) {
		return "";
	}
	return ` {\n${lines.join("\n")}\n}`;
}

function printEnum(type: Extract<CatalogType, { kind: "ENUM" }>): string {
	const values = type.values.map(
		(value) => `${printDescription(value)}${value.name}`,
	);
	return `${printDescription(type)}enum ${type.name}${printBlock(values)}`;
}

function printInputObject(
	type: Extract<CatalogType, { kind: "INPUT_OBJECT" }>,
): string {
	const fields = type.inputFields.map((inputField) =>
		printInputValue(inputField),
	);
	return `${printDescription(type)}input ${type.name}${printBlock(fields)}`;
}

function printInterface(
	type: Extract<CatalogType, { kind: "INTERFACE" }>,
): string {
	return `${printDescription(type)}interface ${type.name}${printBlock(type.fields.map((field) => printField(field)))}`;
}

function printObject(type: Extract<CatalogType, { kind: "OBJECT" }>): string {
	const implementsClause =
		type.implements.length === 0
			? ""
			: ` implements ${type.implements.join(" & ")}`;
	return `${printDescription(type)}type ${type.name}${implementsClause}${printBlock(type.fields.map((field) => printField(field)))}`;
}

function printScalar(type: Extract<CatalogType, { kind: "SCALAR" }>): string {
	return `${printDescription(type)}scalar ${type.name}`;
}

function printUnion(type: Extract<CatalogType, { kind: "UNION" }>): string {
	return `${printDescription(type)}union ${type.name} = ${type.members.join(" | ")}`;
}

function printType(type: CatalogType): string {
	switch (type.kind) {
		case "ENUM": {
			return printEnum(type);
		}
		case "INPUT_OBJECT": {
			return printInputObject(type);
		}
		case "INTERFACE": {
			return printInterface(type);
		}
		case "OBJECT": {
			return printObject(type);
		}
		case "SCALAR": {
			return printScalar(type);
		}
		case "UNION": {
			return printUnion(type);
		}
		default: {
			const exhaustive: never = type;
			return exhaustive;
		}
	}
}

function isEmittedType(type: CatalogType): boolean {
	return !(type.kind === "SCALAR" && builtInScalars.has(type.name));
}

function printSdl(catalog: Catalog): string {
	const body = catalog.types
		.filter((type) => isEmittedType(type))
		.map((type) => printType(type))
		.join("\n\n");
	const sdl = `schema {\n\tquery: Query\n}\n\n${body}\n`;
	parse(sdl);
	return sdl;
}

export { parseCatalog, printSdl };
export default printSdl;
export type { Catalog };
