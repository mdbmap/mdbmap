import type { ReactNode } from "react";
import { tv } from "tailwind-variants";

const section = tv({
	base: "border-t border-line pt-[18px]",
});

export function Section({ children }: { children: ReactNode }) {
	return <section className={section()}>{children}</section>;
}
