import type { ReactNode } from "react";
import { tv } from "tailwind-variants";

const label = tv({
	base: "text-accent font-mono text-[11px] font-medium tracking-[0.1em] uppercase",
});

export function Label({ children }: { children: ReactNode }) {
	return <div className={label()}>{children}</div>;
}
