import type { ResolveResult } from "@/engine";

const instalmentsOf = (resolved: ResolveResult): string[] => {
	const locators: string[] = [];
	for (const segment of resolved.segments) {
		for (const locator of segment.instalments) {
			locators.push(locator);
		}
	}
	return locators;
};

export { instalmentsOf };
