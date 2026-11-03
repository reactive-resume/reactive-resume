import type { ReactNode } from "react";
import { Trans } from "@lingui/react/macro";
import { LandingFooter } from "./footer";
import { LandingHeader, ThemeCord } from "./header";

type MarketingLayoutProps = { children: ReactNode };

/** Public marketing chrome, shared by live routes and their anonymous build-time HTML. */
export function MarketingLayout({ children }: MarketingLayoutProps) {
	return (
		<div className="landing relative isolate bg-bg font-ui text-ink">
			<a
				href="#main-content"
				className="sr-only focus:not-sr-only focus:fixed focus:inset-s-4 focus:top-4 focus:z-100 focus:rounded-md focus:bg-bg focus:px-4 focus:py-2 focus:text-ink focus:shadow-lg focus:ring-2 focus:ring-accent"
			>
				<Trans>Skip to main content</Trans>
			</a>
			<LandingHeader story={false} />
			<ThemeCord />
			{children}
			<LandingFooter story={false} />
		</div>
	);
}
