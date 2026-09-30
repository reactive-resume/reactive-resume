import { createFileRoute, redirect, SearchParamError } from "@tanstack/react-router";
import { critiquePasswordSearchSchema } from "@/features/auth/critique-password-search";
import { CritiquePasswordPage } from "@/features/auth/pages/critique-password";

export const Route = createFileRoute("/auth/critique-password")({
	component: RouteComponent,
	validateSearch: critiquePasswordSearchSchema,
	onError: (error) => {
		if (error instanceof SearchParamError) {
			throw redirect({ to: "/" });
		}
	},
});

function RouteComponent() {
	const { redirect, returnTo } = Route.useSearch();
	const [username, slug] = redirect.slice(1).split("/") as [string, string, string];

	return <CritiquePasswordPage username={username} slug={slug} redirectPath={returnTo ?? redirect} />;
}
