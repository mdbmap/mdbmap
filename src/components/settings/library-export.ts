import type { LibraryEntry } from "@/orpc/schema";

const EXPORT_VERSION = 1;
const FILE_NAME = "mdbmap-library.json";

interface LibraryExportFile {
	exportedAt: string;
	version: number;
	works: readonly LibraryEntry[];
}

const libraryExportPayload = (
	entries: readonly LibraryEntry[],
	exportedAt: string,
): LibraryExportFile => ({
	exportedAt,
	version: EXPORT_VERSION,
	works: entries,
});

const libraryExportJson = (
	entries: readonly LibraryEntry[],
	exportedAt: string,
): string =>
	`${JSON.stringify(libraryExportPayload(entries, exportedAt), undefined, "\t")}\n`;

const downloadLibraryExport = (json: string): void => {
	const blob = new Blob([json], { type: "application/json" });
	const href = URL.createObjectURL(blob);
	const link = document.createElement("a");
	link.download = FILE_NAME;
	link.href = href;
	link.click();
	URL.revokeObjectURL(href);
};

export { downloadLibraryExport, FILE_NAME, libraryExportJson };
export type { LibraryExportFile };
