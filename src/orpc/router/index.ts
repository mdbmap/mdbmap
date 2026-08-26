import { apiKeys } from "./api-keys";
import { moderation } from "./moderation";
import { research } from "./research";
import { addTodo, listTodos } from "./todos";
import { tracking } from "./tracking";
import { work } from "./work";

export const router = {
	addTodo,
	apiKeys,
	listTodos,
	moderation,
	research,
	tracking,
	work,
};
