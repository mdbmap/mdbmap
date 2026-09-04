import { apiKeys } from "./api-keys";
import { ingest } from "./ingest";
import { library } from "./library";
import { moderation } from "./moderation";
import { orders } from "./orders";
import { providers } from "./providers";
import { search } from "./search";
import { sync } from "./sync";
import { tracking } from "./tracking";
import { work } from "./work";

export const router = {
	apiKeys,
	ingest,
	library,
	moderation,
	orders,
	providers,
	search,
	sync,
	tracking,
	work,
};
