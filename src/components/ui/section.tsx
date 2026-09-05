import type { ReactNode } from "react";
import { tv } from "tailwind-variants";

const section = tv({
	base: "border-line border-t pt-[18px]",
});

export function Section({ children }: { children: ReactNode }) {
	return <section className={section()}>{children}</section>;
}
