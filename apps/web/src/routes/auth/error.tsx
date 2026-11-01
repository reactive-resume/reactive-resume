import { t } from "@lingui/core/macro";
import { createFileRoute } from "@tanstack/react-router";
import z from "zod";
import { AuthErrorPage } from "@/features/auth/pages/error";
import { getPageTitle } from "@/libs/seo";

// Better Auth redirects here with `?error=<code>` and an optional `&error_description=<text>`.
// Both are tolerated as missing so an unrecognised redirect still renders the page instead of
// throwing into the error boundary.
const searchSchema = z.object({
	error: z.string().optional().catch(undefined),
	error_description: z.string().optional().catch(undefined),
});

export const Route = createFileRoute("/auth/error")({
	head: () => ({ meta: [{ title: getPageTitle(t`Authentication error`) }] }),
	component: RouteComponent,
	validateSearch: searchSchema,
});

function RouteComponent() {
	const search = Route.useSearch();

	return <AuthErrorPage code={search.error} description={search.error_description} />;
}
