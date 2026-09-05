interface MetadataKv {
	get: (key: string) => Promise<string | undefined>;
	put: (
		key: string,
		value: string,
		options?: { expirationTtl: number },
	) => Promise<void>;
}

export type { MetadataKv };
