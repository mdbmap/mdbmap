// Ruled poster placeholders are hue-parameterised, but Tailwind only emits classes
// it can see as literals — so the hue cycle maps to static class names here.
const posterClass = [
	"poster-340",
	"poster-300",
	"poster-225",
	"poster-150",
	"poster-352",
	"poster-20",
] as const;

const posterHue = (index: number) =>
	posterClass[index % posterClass.length] ?? posterClass[0];

// Snapshot refs (e.g. `anidb:c-anya`) become resolvable URLs in #5/#6; until then
// only absolute http refs are displayable, everything else falls back to the ruled
// placeholder — matching the banner's "image absent" treatment.
const imageUrl = (ref: string | undefined) =>
	ref !== undefined && /^https?:\/\//u.test(ref) ? ref : undefined;

export { imageUrl, posterHue };
