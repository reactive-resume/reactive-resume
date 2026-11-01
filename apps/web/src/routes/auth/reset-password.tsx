import { t } from "@lingui/core/macro";
import { createFileRoute, redirect, SearchParamError } from "@tanstack/react-router";
import z from "zod";
import { ResetPasswordPage } from "@/features/auth/pages/reset-password";
import { getPageTitle } from "@/libs/seo";

const searchSchema = z.object({ token: z.string().min(1) });

export const Route = createFileRoute("/auth/reset-password")({
	head: () => ({ meta: [{ title: getPageTitle(t`Reset password`) }] }),
	component: RouteComponent,
	validateSearch: searchSchema,
	beforeLoad: ({ context }) => {
		if (context.flags.disableEmailAuth) throw redirect({ to: "/auth/login", replace: true });
	},
	onError: (error) => {
		if (error instanceof SearchParamError) {
			throw redirect({ to: "/auth/login" });
		}
	},
});

function RouteComponent() {
	const { token } = Route.useSearch();

	return <ResetPasswordPage token={token} />;
}
