import { createFileRoute, redirect } from "@tanstack/react-router";

// API keys live under Developer now; the old address (the dsh plugin documents it) keeps working.
export const Route = createFileRoute("/dashboard/settings/api-keys")({
	beforeLoad: () => {
		throw redirect({ to: "/dashboard/settings/developer", hash: "api-keys", replace: true });
	},
});
