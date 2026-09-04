import { Label } from "@/components/ui/label";
import { Section } from "@/components/ui/section";
import type { CatalogueLink } from "@/orpc/schema";

const HEADING = "Catalogues";

function CatalogueRow({ link }: { link: CatalogueLink }) {
	return (
		<div className="flex items-baseline gap-1.5">
			<span className="text-ink/75 mr-auto">{link.label}</span>
			<a
				className="hover:text-accent"
				href={link.href}
				rel="noreferrer noopener"
				target="_blank"
			>
				{link.id}
			</a>
		</div>
	);
}

function CatalogueList({ links }: { links: CatalogueLink[] }) {
	return (
		<div className="mt-2.5 flex flex-col gap-2 font-mono text-[11.5px]">
			{links.map((link) => (
				<CatalogueRow key={`${link.service}:${link.id}`} link={link} />
			))}
		</div>
	);
}

function Catalogues({ catalogues }: { catalogues: CatalogueLink[] }) {
	if (catalogues.length === 0) {
		return false;
	}
	return (
		<Section>
			<Label>{HEADING}</Label>
			<CatalogueList links={catalogues} />
		</Section>
	);
}

export { Catalogues };
