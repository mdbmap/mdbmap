import { apiKeys } from "./api-keys";
import { billing } from "./billing";
import { calendar } from "./calendar";
import { libraryImport } from "./import";
import { ingest } from "./ingest";
import { library } from "./library";
import { moderation } from "./moderation";
import { orderProposals } from "./order-proposals";
import { orders } from "./orders";
import { providers } from "./providers";
import { search } from "./search";
import { sync } from "./sync";
import { tracking } from "./tracking";
import { work } from "./work";

export const router = {
	apiKeys,
	billing,
	calendar,
	import: libraryImport,
	ingest,
	library,
	moderation,
	orderProposals,
	orders,
	providers,
	search,
	sync,
	tracking,
	work,
};
