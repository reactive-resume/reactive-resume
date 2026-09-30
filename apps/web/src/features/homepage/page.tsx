import { t } from "@lingui/core/macro";
import { useRef } from "react";
import { LandingBackground } from "./background";
import { Check } from "./check";
import { Design } from "./design";
import { Faq } from "./faq";
import { LandingFooter } from "./footer";
import { LandingHeader, ThemeCord } from "./header";
import { Hero } from "./hero";
import { useScrollScenes } from "./scroll";
import { Closing, Languages, Numbers, Support } from "./sections";
import { Share } from "./share";
import { Tailor } from "./tailor";
import { Write } from "./write";

/**
 * The public landing page: one scroll-driven story, "Everything you've done, on one page." A single resume page is
 * assembled, written, restyled, checked, tailored and sent as the visitor scrolls, followed by community proof,
 * languages, support, common questions, a closing call to action and the footer. The server prerenders it
 * (prerender.tsx), so every word is in the first response.
 */
export function Homepage() {
	const root = useRef<HTMLDivElement>(null);
	useScrollScenes(root);

	return (
		<div ref={root} className="landing relative isolate overflow-x-clip bg-bg font-ui text-ink">
			<LandingBackground />
			<a
				href="#main"
				className="fixed start-4 top-2.5 z-100 -translate-y-[160%] rounded-md bg-ink px-3.5 py-2.5 font-ui text-sm font-semibold text-bg transition-transform focus:translate-y-0"
			>
				{t`Skip to content`}
			</a>
			<LandingHeader />
			<ThemeCord />
			<main id="main">
				<Hero />
				<Write />
				<Design />
				<Check />
				<Tailor />
				<Share />
				<Numbers />
				<Languages />
				<Support />
				<Faq />
				<Closing />
			</main>
			<LandingFooter />
		</div>
	);
}
