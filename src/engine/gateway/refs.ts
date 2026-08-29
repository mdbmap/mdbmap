const WARM_RETRY_AFTER_SECONDS = 5;

const statusUrlFor = (ref: string): string => `/api/engine/status/${ref}`;

export { WARM_RETRY_AFTER_SECONDS, statusUrlFor };
