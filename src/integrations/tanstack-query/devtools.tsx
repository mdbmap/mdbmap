import { ReactQueryDevtoolsPanel } from "@tanstack/react-query-devtools";

export const queryDevtoolsPlugin = {
	name: "Tanstack Query",
	render: <ReactQueryDevtoolsPanel />,
};
