import { createFileRoute, redirect } from "@tanstack/react-router";

// The cover-letter library is now the Letters tab in Documents (6.0). This stub keeps old links working (Q2).
export const Route = createFileRoute("/dashboard/cover-letters")({
	beforeLoad: () => {
		throw redirect({ to: "/dashboard/documents", search: { type: "letter" }, replace: true });
	},
});
