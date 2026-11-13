import { createFileRoute, redirect } from "@tanstack/react-router";

// Trash became one page for documents and applications; the old address opens it on applications.
export const Route = createFileRoute("/dashboard/applications/trash")({
	beforeLoad: () => {
		throw redirect({ to: "/dashboard/trash", search: { kind: "applications" }, replace: true });
	},
});
