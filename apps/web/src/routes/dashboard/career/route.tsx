import type { IconName } from "@reactive-resume/ui/components/icon";
import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { createFileRoute, Link, Outlet, useMatchRoute } from "@tanstack/react-router";
import { Icon } from "@reactive-resume/ui/components/icon";
import { Tabs, TabsList, TabsTrigger } from "@reactive-resume/ui/components/tabs";
import { PageHeader } from "@/components/layout/page-header";
import { getPageTitle } from "@/libs/seo";

export const Route = createFileRoute("/dashboard/career")({
	head: () => ({ meta: [{ title: getPageTitle(t`Career`) }] }),
	component: CareerLayout,
});

type Place = {
	to:
		| "/dashboard/career"
		| "/dashboard/career/coach/{-$conversationId}"
		| "/dashboard/career/knowledge/facts"
		| "/dashboard/career/offers";
	match: string;
	icon: IconName;
	label: string;
};

/** Career: Today, Coach, Knowledge and Offers under one header. The selected place's underline slides between them. */
function CareerLayout() {
	const matchRoute = useMatchRoute();
	const places: Place[] = [
		{ to: "/dashboard/career", match: "/dashboard/career/", icon: "tray", label: t`Today` },
		{
			to: "/dashboard/career/coach/{-$conversationId}",
			match: "/dashboard/career/coach",
			icon: "sparkle",
			label: t`Coach`,
		},
		{
			to: "/dashboard/career/knowledge/facts",
			match: "/dashboard/career/knowledge",
			icon: "books",
			label: t`Knowledge`,
		},
		{ to: "/dashboard/career/offers", match: "/dashboard/career/offers", icon: "scales", label: t`Offers` },
	];
	const current = places.find((place) => matchRoute({ to: place.match, fuzzy: place.match !== "/dashboard/career/" }));

	return (
		<div className="mx-auto flex min-h-svh w-full max-w-[1180px] flex-col gap-5 px-8 py-8 max-sm:px-4 max-sm:py-5">
			<PageHeader
				title={<Trans>Career</Trans>}
				description={<Trans>Plan your search, keep your evidence in one place, and decide between offers.</Trans>}
			>
				<Tabs
					value={current?.to ?? null}
					className="-mx-4 max-w-[100vw] [scrollbar-width:none] overflow-x-auto px-4 sm:mx-0 sm:px-0"
				>
					<TabsList variant="line" aria-label={t`Career`}>
						{places.map((place) => (
							<TabsTrigger
								key={place.to}
								value={place.to}
								nativeButton={false}
								render={<Link to={place.to} aria-current={place === current ? "page" : undefined} />}
							>
								<Icon name={place.icon} size={18} />
								{place.label}
							</TabsTrigger>
						))}
					</TabsList>
				</Tabs>
			</PageHeader>
			<Outlet />
		</div>
	);
}
