import { createFileRoute, redirect } from "@tanstack/react-router";
import { RegisterPage } from "@/features/auth/pages/register";
import { getAuthRedirectOptions } from "@/features/auth/redirect";

export const Route = createFileRoute("/auth/register")({
	component: RouteComponent,
	beforeLoad: ({ context, search }) => {
		// Guests come here to keep their work: signing up or in from a guest session moves it to that account.
		if (context.session && !context.session.user.isAnonymous && !search.reauthenticate)
			throw redirect(getAuthRedirectOptions(search.callbackURL));
		if (context.flags.disableSignups) throw redirect({ to: "/auth/login", search, replace: true });
		return { session: null, isGuest: Boolean(context.session?.user.isAnonymous) };
	},
});

function RouteComponent() {
	const { flags, isGuest } = Route.useRouteContext();

	return <RegisterPage disableEmailAuth={flags.disableEmailAuth} isGuest={isGuest} />;
}
