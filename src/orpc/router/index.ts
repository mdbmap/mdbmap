import { apiKeys } from "./api-keys";
import { moderation } from "./moderation";
import { providers } from "./providers";
import { addTodo, listTodos } from "./todos";
import { tracking } from "./tracking";
import { work } from "./work";

export const router = {
	addTodo,
	apiKeys,
	listTodos,
	moderation,
	providers,
	tracking,
	work,
};
