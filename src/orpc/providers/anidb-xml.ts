// A minimal reader for AniDB's well-formed HTTP-API XML. It is deliberately not a
// general XML library: it covers elements, attributes, text, CDATA, comments and
// the XML declaration, which is all the anime endpoint emits.

interface XmlNode {
	attrs: Readonly<Record<string, string>>;
	children: readonly XmlNode[];
	tag: string;
	text: string;
}

const ENTITIES = new Map<string, string>([
	["amp", "&"],
	["apos", "'"],
	["gt", ">"],
	["lt", "<"],
	["quot", '"'],
]);

const DECIMAL_RADIX = 10;
const HEX_RADIX = 16;

const ENTITY_PATTERN = /&(?<body>#x?[0-9a-fA-F]+|[a-zA-Z]+);/gu;

const decodeEntities = (input: string): string =>
	input.replaceAll(ENTITY_PATTERN, (match, body: string) => {
		if (body.startsWith("#x") || body.startsWith("#X")) {
			return String.fromCodePoint(Number.parseInt(body.slice(2), HEX_RADIX));
		}
		if (body.startsWith("#")) {
			return String.fromCodePoint(
				Number.parseInt(body.slice(1), DECIMAL_RADIX),
			);
		}
		return ENTITIES.get(body) ?? match;
	});

const ATTR_PATTERN =
	/(?<dqName>[\w:.-]+)\s*=\s*"(?<dqValue>[^"]*)"|(?<sqName>[\w:.-]+)\s*=\s*'(?<sqValue>[^']*)'/gu;

const parseAttrs = (source: string): Record<string, string> => {
	const attrs: Record<string, string> = {};
	for (const match of source.matchAll(ATTR_PATTERN)) {
		const name = match.groups?.["dqName"] ?? match.groups?.["sqName"];
		const value = match.groups?.["dqValue"] ?? match.groups?.["sqValue"];
		if (name !== undefined && value !== undefined) {
			attrs[name] = decodeEntities(value);
		}
	}
	return attrs;
};

interface Cursor {
	index: number;
}

const skipMisc = (xml: string, cursor: Cursor): void => {
	for (;;) {
		if (xml.startsWith("<?", cursor.index)) {
			cursor.index = xml.indexOf("?>", cursor.index) + 2;
		} else if (xml.startsWith("<!--", cursor.index)) {
			cursor.index = xml.indexOf("-->", cursor.index) + 3;
		} else if (xml.startsWith("<!", cursor.index)) {
			cursor.index = xml.indexOf(">", cursor.index) + 1;
		} else {
			return;
		}
		while (cursor.index < xml.length && /\s/u.test(xml[cursor.index] ?? "")) {
			cursor.index += 1;
		}
	}
};

const readText = (xml: string, cursor: Cursor): string => {
	let text = "";
	while (cursor.index < xml.length && xml[cursor.index] !== "<") {
		text += xml[cursor.index];
		cursor.index += 1;
	}
	if (xml.startsWith("<![CDATA[", cursor.index)) {
		const end = xml.indexOf("]]>", cursor.index);
		text += xml.slice(cursor.index + "<![CDATA[".length, end);
		cursor.index = end + 3;
		return text + readText(xml, cursor);
	}
	return decodeEntities(text);
};

const parseElement = (xml: string, cursor: Cursor): XmlNode => {
	const tagEnd = xml.indexOf(">", cursor.index);
	const selfClosing = xml[tagEnd - 1] === "/";
	const inner = xml.slice(cursor.index + 1, selfClosing ? tagEnd - 1 : tagEnd);
	const nameEnd = inner.search(/[\s/]/u);
	const tag = nameEnd === -1 ? inner : inner.slice(0, nameEnd);
	const attrs = parseAttrs(nameEnd === -1 ? "" : inner.slice(nameEnd));
	cursor.index = tagEnd + 1;

	if (selfClosing) {
		return { attrs, children: [], tag, text: "" };
	}

	const children: XmlNode[] = [];
	let text = "";
	for (;;) {
		text += readText(xml, cursor);
		if (xml.startsWith("</", cursor.index)) {
			cursor.index = xml.indexOf(">", cursor.index) + 1;
			return { attrs, children, tag, text: text.trim() };
		}
		if (xml.startsWith("<!--", cursor.index)) {
			cursor.index = xml.indexOf("-->", cursor.index) + 3;
			continue;
		}
		children.push(parseElement(xml, cursor));
	}
};

const parseXml = (xml: string): XmlNode => {
	const cursor: Cursor = { index: 0 };
	while (cursor.index < xml.length && /\s/u.test(xml[cursor.index] ?? "")) {
		cursor.index += 1;
	}
	skipMisc(xml, cursor);
	return parseElement(xml, cursor);
};

const childrenNamed = (node: XmlNode, tag: string): readonly XmlNode[] =>
	node.children.filter((child) => child.tag === tag);

const firstChild = (node: XmlNode, tag: string): XmlNode | undefined =>
	node.children.find((child) => child.tag === tag);

export { childrenNamed, firstChild, parseXml };
export type { XmlNode };
