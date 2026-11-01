import { createFileRoute, redirect } from "@tanstack/react-router";
import { OAuthConsentPage } from "@/features/auth/pages/consent";

export const Route = createFileRoute("/auth/consent")({
	beforeLoad: ({ context }) => {
		if (!context.session) {
			throw redirect({
				to: "/auth/login",
				search: {
					callbackURL: `/api/auth/oauth${window.location.search}`,
				},
			});
		}
		return { session: context.session };
	},
	component: RouteComponent,
});

function RouteComponent() {
	const { session, flags } = Route.useRouteContext();
	// This route is client-only. TanStack serializes repeated parameters as JSON
	// arrays in location.searchStr, invalidating the provider signature. Use the URL verbatim.
	const oauthQuery = window.location.search.slice(1);
	return (
		<OAuthConsentPage
			key={oauthQuery}
			oauthQuery={oauthQuery}
			email={session.user.email}
			isAnonymous={session.user.isAnonymous === true}
			disableSignups={flags.disableSignups}
		/>
	);
}
