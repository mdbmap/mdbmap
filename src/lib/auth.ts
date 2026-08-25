import { betterAuth } from "better-auth";
import { admin } from "better-auth/plugins";
import { tanstackStartCookies } from "better-auth/tanstack-start";

export const auth = betterAuth({
	emailAndPassword: {
		enabled: true,
	},
	plugins: [admin(), tanstackStartCookies()],
});
