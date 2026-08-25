import type { ReactNode } from "react";
import { tv } from "tailwind-variants";

const label = tv({
	base: "font-mono text-[11px] font-medium tracking-[0.1em] text-accent uppercase",
});

export function Label({ children }: { children: ReactNode }) {
	return <div className={label()}>{children}</div>;
}
