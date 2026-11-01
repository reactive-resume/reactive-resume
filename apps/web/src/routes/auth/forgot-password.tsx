import { t } from "@lingui/core/macro";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { ForgotPasswordPage } from "@/features/auth/pages/forgot-password";
import { getPageTitle } from "@/libs/seo";

export const Route = createFileRoute("/auth/forgot-password")({
	head: () => ({ meta: [{ title: getPageTitle(t`Forgot password`) }] }),
	component: ForgotPasswordPage,
	beforeLoad: ({ context }) => {
		if (context.flags.disableEmailAuth) throw redirect({ to: "/auth/login", replace: true });
	},
});
