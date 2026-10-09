import { createFileRoute, redirect } from "@tanstack/react-router";

// The Agents pages became the assistant in the editor; their links redirect there (through 6.0.x).
export const Route = createFileRoute("/agent")({
	beforeLoad: ({ context, location }) => {
		if (!context.session) throw redirect({ to: "/auth/login", search: { callbackURL: location.href }, replace: true });
	},
});
