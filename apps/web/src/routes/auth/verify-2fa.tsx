import { t } from "@lingui/core/macro";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { VerifyTwoFactorPage } from "@/features/auth/pages/verify-2fa";
import { getAuthRedirectOptions } from "@/features/auth/redirect";
import { getPageTitle } from "@/libs/seo";

export const Route = createFileRoute("/auth/verify-2fa")({
	head: () => ({ meta: [{ title: getPageTitle(t`Two-factor authentication`) }] }),
	component: VerifyTwoFactorPage,
	beforeLoad: ({ context, search }) => {
		if (context.session && !search.reauthenticate) throw redirect(getAuthRedirectOptions(search.callbackURL));
	},
});
