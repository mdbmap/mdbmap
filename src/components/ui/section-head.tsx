import type { ReactNode } from "react";
import { tv } from "tailwind-variants";

const sectionHead = tv({
	base: "text-ink/90 font-serif text-xl font-normal",
});

export function SectionHead({ children }: { children: ReactNode }) {
	return <h2 className={sectionHead()}>{children}</h2>;
}
