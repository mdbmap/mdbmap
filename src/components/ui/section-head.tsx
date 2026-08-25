import type { ReactNode } from "react";
import { tv } from "tailwind-variants";

const sectionHead = tv({
	base: "font-serif text-xl font-normal text-ink/90",
});

export function SectionHead({ children }: { children: ReactNode }) {
	return <h2 className={sectionHead()}>{children}</h2>;
}
