import { Label } from "@/components/ui/label";
import { Section } from "@/components/ui/section";
import { SectionHead } from "@/components/ui/section-head";
import { ThemeToggle } from "@/components/ui/theme-toggle";

const BRAND = "mdbmap";
const TITLE = "Design system";
const TAGLINE =
	"Rosé Pine on warm paper — Newsreader italics, Zen Maru Gothic body, JetBrains Mono for data. Sharp corners, one rose accent, light and dark.";
const PALETTE_LABEL = "Palette";
const TYPE_HEAD = "Three families";

const swatches = [
	{ cls: "poster-340", name: "rose" },
	{ cls: "poster-300", name: "iris" },
	{ cls: "poster-225", name: "pine" },
	{ cls: "poster-150", name: "foam" },
	{ cls: "poster-352", name: "love" },
	{ cls: "poster-20", name: "gold" },
] as const;

const families = [
	{ face: "font-serif text-2xl text-ink/90 italic", name: "Newsreader", role: "titles" },
	{ face: "text-lg text-ink/90", name: "Zen Maru Gothic", role: "body" },
	{ face: "font-mono text-lg text-ink/90", name: "JetBrains Mono", role: "data" },
] as const;

function Header() {
	return (
		<header className="flex items-center justify-between">
			<span className="font-mono text-xs font-medium tracking-[0.1em] text-accent uppercase">
				{BRAND}
			</span>
			<ThemeToggle />
		</header>
	);
}

function Hero() {
	return (
		<section>
			<h1 className="font-serif text-5xl text-ink/95 italic">{TITLE}</h1>
			<p className="mt-4 max-w-[60ch] text-[15px] leading-relaxed text-ink/80">
				{TAGLINE}
			</p>
		</section>
	);
}

function Swatch({ cls, name }: { cls: string; name: string }) {
	return (
		<div>
			<div className={`h-16 border border-line ${cls}`} />
			<div className="mt-2 font-mono text-[11px] text-ink/45">{name}</div>
		</div>
	);
}

function PaletteSection() {
	return (
		<Section>
			<Label>{PALETTE_LABEL}</Label>
			<div className="mt-4 grid grid-cols-6 gap-3">
				{swatches.map((swatch) => (
					<Swatch key={swatch.name} cls={swatch.cls} name={swatch.name} />
				))}
			</div>
		</Section>
	);
}

function TypeRow({ face, name, role }: { face: string; name: string; role: string }) {
	return (
		<div className="flex items-baseline justify-between border-b border-line pb-3">
			<span className={face}>{name}</span>
			<span className="font-mono text-[11px] text-ink/45">{role}</span>
		</div>
	);
}

function TypeSection() {
	return (
		<Section>
			<SectionHead>{TYPE_HEAD}</SectionHead>
			<div className="mt-4 flex flex-col gap-3">
				{families.map((family) => (
					<TypeRow key={family.name} face={family.face} name={family.name} role={family.role} />
				))}
			</div>
		</Section>
	);
}

export function Home() {
	return (
		<main className="mx-auto flex max-w-3xl flex-col gap-10 px-8 py-14">
			<Header />
			<Hero />
			<PaletteSection />
			<TypeSection />
		</main>
	);
}
