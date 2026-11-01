import { t } from "@lingui/core/macro";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { LoginPage } from "@/features/auth/pages/login";
import { getAuthRedirectOptions } from "@/features/auth/redirect";
import { getPageTitle } from "@/libs/seo";

export const Route = createFileRoute("/auth/login")({
	head: () => ({ meta: [{ title: getPageTitle(t`Sign in`) }] }),
	component: RouteComponent,
	beforeLoad: ({ context, search }) => {
		// Guests come here to keep their work: signing up or in from a guest session moves it to that account.
		if (context.session && !context.session.user.isAnonymous && !search.reauthenticate)
			throw redirect(getAuthRedirectOptions(search.callbackURL));
		return { session: null, isGuest: Boolean(context.session?.user.isAnonymous) };
	},
});

function RouteComponent() {
	const { flags, isGuest } = Route.useRouteContext();

	return (
		<LoginPage
			disableEmailAuth={flags.disableEmailAuth}
			disableSignups={flags.disableSignups}
			allowGuestLogin={flags.allowGuestLogin && !isGuest}
			isGuest={isGuest}
		/>
	);
}
