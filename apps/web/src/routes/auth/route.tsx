import { createFileRoute } from "@tanstack/react-router";
import { NotFoundScreen } from "@/components/layout/not-found-screen";
import { AuthLayout } from "@/features/auth/layout";
import { authSearchSchema } from "@/features/auth/redirect";
import { createNoindexFollowMeta } from "@/libs/seo";

export const Route = createFileRoute("/auth")({
	component: AuthLayout,
	// The sign-in pages' frame already shows the logo.
	notFoundComponent: () => <NotFoundScreen inLayout />,
	validateSearch: authSearchSchema,
	head: () => ({
		meta: [createNoindexFollowMeta()],
	}),
});
