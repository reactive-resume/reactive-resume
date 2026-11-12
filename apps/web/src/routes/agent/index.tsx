import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/agent/")({
	beforeLoad: () => {
		throw redirect({ to: "/dashboard/documents", replace: true });
	},
});
