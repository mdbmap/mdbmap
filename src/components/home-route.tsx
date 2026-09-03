import { useSearch } from "@tanstack/react-router";

import { Home } from "@/components/home";

export function HomeRoute() {
	const { signin } = useSearch({ from: "/" });
	return <Home signinRequested={signin === true} />;
}
