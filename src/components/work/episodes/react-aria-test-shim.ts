import type { ReactNode } from "react";
import { createElement } from "react";

const noopClose = () => {
	/* empty */
};

const passthrough = (tag: string) => {
	function Component({
		children,
		...rest
	}: {
		children?: ReactNode;
	} & Record<string, unknown>) {
		return createElement(tag, rest, children);
	}
	return Component;
};

const reactAriaTestShim = {
	Button: passthrough("button"),
	Dialog: ({
		children,
	}: {
		children?: ReactNode | ((opts: { close: () => void }) => ReactNode);
	}) => {
		const content =
			typeof children === "function"
				? children({ close: noopClose })
				: children;
		return createElement("div", { role: "dialog" }, content);
	},
	DialogTrigger: ({
		children,
		isOpen,
	}: {
		children?: ReactNode;
		isOpen?: boolean;
	}) =>
		createElement(
			"div",
			{ "data-dialog-open": String(isOpen === true) },
			children,
		),
	Form: passthrough("form"),
	Heading: passthrough("h2"),
	Input: passthrough("input"),
	Label: passthrough("label"),
	Modal: passthrough("div"),
	ModalOverlay: ({
		children,
		...rest
	}: {
		children?: ReactNode;
	} & Record<string, unknown>) => createElement("div", rest, children),
	TextField: passthrough("div"),
};

export { reactAriaTestShim };
