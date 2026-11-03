import { t } from "@lingui/core/macro";
import { createFileRoute, redirect } from "@tanstack/react-router";
import z from "zod";
import { ResetPasswordPage } from "@/features/auth/pages/reset-password";
import { getPageTitle } from "@/libs/seo";

const searchSchema = z.object({
	token: z.string().min(1).optional().catch(undefined),
	error: z.string().optional().catch(undefined),
});

export const Route = createFileRoute("/auth/reset-password")({
	head: () => ({ meta: [{ title: getPageTitle(t`Reset password`) }] }),
	component: RouteComponent,
	validateSearch: searchSchema,
	beforeLoad: ({ context }) => {
		if (context.flags.disableEmailAuth) throw redirect({ to: "/auth/login", replace: true });
	},
});

function RouteComponent() {
	const { token, error } = Route.useSearch();

	return <ResetPasswordPage token={error ? undefined : token} />;
}
