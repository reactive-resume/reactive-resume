import { t } from "@lingui/core/macro";
import { Link } from "@tanstack/react-router";
import { AtsChecker } from "./checker";
import { LandingBackground } from "@/features/homepage/background";
import { Doodle } from "@/features/homepage/ui";

type AtsCheckerPageProps = { signedIn: boolean; importPending: boolean };

/**
 * The /ats-checker page, which the build also prerenders (features/homepage/prerender.tsx). The checker's first screen
 * is light, and PDF.js and the analysis engine load only once a file is chosen, so it renders without a loading state.
 */
export function AtsCheckerPage({ signedIn, importPending }: AtsCheckerPageProps) {
	return (
		// On the homepage's desk, as its Check scene sold it: the grain and window light, and the magnifier beside the
		// title. The marketing header is fixed and 65px tall, so the page makes room for it.
		<div className="landing relative isolate min-h-svh overflow-x-clip bg-bg font-ui text-ink">
			<LandingBackground />
			<main id="main-content" className="relative pt-20">
				<Doodle
					name="magnifier"
					wipe="1"
					sizes="(min-width: 900px) 12vw, 1px"
					className="end-[6vw] top-24 w-[clamp(120px,12vw,200px)] rotate-[-8deg] max-[900px]:hidden"
				/>
				<AtsChecker signedIn={signedIn} importPending={importPending} />
				<p className="mx-auto max-w-3xl px-6 pb-12 text-center text-ink-2">
					<Link to="/resume-templates" className="text-accent-text underline underline-offset-4">
						{t`Browse free resume templates and sample PDFs`}
					</Link>
				</p>
			</main>
		</div>
	);
}
