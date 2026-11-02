import { createFileRoute, redirect } from "@tanstack/react-router";

// Settings became three pages in 6.0; the old address redirects (through 6.0.x).
export const Route = createFileRoute("/dashboard/settings/api-keys")({
	beforeLoad: () => {
		throw redirect({ to: "/dashboard/settings/ai", hash: "api-keys", replace: true });
	},
});
