import { AtsChecker } from "./checker";

type AtsCheckerPageProps = { signedIn: boolean; importPending: boolean };

/**
 * The /ats-checker page, which the build also prerenders (features/homepage/prerender.tsx). The checker's first screen
 * is light, and PDF.js and the analysis engine load only once a file is chosen, so it renders without a loading state.
 */
export function AtsCheckerPage({ signedIn, importPending }: AtsCheckerPageProps) {
	return (
		// A full screen under the 64px public header, so the site footer starts below the fold.
		<main id="main-content" className="flex min-h-[calc(100svh-4rem)] flex-1 flex-col">
			<AtsChecker signedIn={signedIn} importPending={importPending} />
		</main>
	);
}
