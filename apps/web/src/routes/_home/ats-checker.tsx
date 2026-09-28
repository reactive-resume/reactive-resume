import { Trans } from "@lingui/react/macro";
import { CheckCircleIcon, ProhibitIcon, ShieldCheckIcon } from "@phosphor-icons/react";
import { createFileRoute } from "@tanstack/react-router";
import { m } from "motion/react";
import { lazy, Suspense } from "react";
import { Skeleton } from "@reactive-resume/ui/components/skeleton";
import { Spotlight } from "@/components/animation/spotlight";
import { AiReviewCard } from "@/features/ats-checker/ai-review/ai-review-card";
import { LockedAiCard } from "@/features/ats-checker/ai-review/locked-card";
import { ParsePreview } from "@/features/ats-checker/parse-preview";
import { EASE_OUT_STRONG } from "@/libs/motion";
import { Footer } from "./-sections/footer";

const PAGE_TITLE = "ATS Checker - Reactive Resume";
const PAGE_DESCRIPTION =
	"Check whether software can read your resume PDF. Runs entirely in your browser, so your file is never uploaded.";

// The checker pulls in PDF.js and the analysis engine, neither of which the page copy needs.
const AtsCheckerTool = lazy(() =>
	import("@/features/ats-checker/tool").then((module) => ({ default: module.AtsCheckerTool })),
);

export const Route = createFileRoute("/_home/ats-checker")({
	component: RouteComponent,
	head: () => {
		const origin = typeof window === "undefined" ? "https://rxresu.me" : window.location.origin;
		const canonicalUrl = new URL("/ats-checker", origin).toString();
		const imageUrl = new URL("/opengraph/ats-checker.png", origin).toString();

		return {
			meta: [
				{ title: PAGE_TITLE },
				{ name: "description", content: PAGE_DESCRIPTION },
				{ property: "og:title", content: PAGE_TITLE },
				{ property: "og:description", content: PAGE_DESCRIPTION },
				{ property: "og:url", content: canonicalUrl },
				{ property: "og:type", content: "website" },
				{ property: "og:image", content: imageUrl },
				{ name: "twitter:card", content: "summary_large_image" },
				{ name: "twitter:url", content: canonicalUrl },
				{ name: "twitter:title", content: PAGE_TITLE },
				{ name: "twitter:description", content: PAGE_DESCRIPTION },
				{ name: "twitter:image", content: imageUrl },
			],
			links: [{ rel: "canonical", href: canonicalUrl }],
		};
	},
});

function RouteComponent() {
	const { session } = Route.useRouteContext();

	return (
		// The marketing header is `fixed` and 65px tall. The homepage clears it with a full-height
		// hero; this page has to make the room itself or its first row sits underneath.
		<main id="main-content" className="relative pt-20 lg:pt-24">
			<div className="container mx-auto px-4 sm:px-6 lg:px-12">
				<div className="border-border border-x">
					<Header />

					<div className="grid border-border border-t lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)]">
						<section className="border-border p-4 md:p-8 lg:border-e">
							<Suspense fallback={<ToolSkeleton />}>
								<AtsCheckerTool
									renderAiTier={({ result, jobDescription }) =>
										session ? (
											<AiReviewCard report={result.report} fullText={result.fullText} jobDescription={jobDescription} />
										) : (
											<LockedAiCard />
										)
									}
								/>
							</Suspense>
						</section>

						<aside className="space-y-8 p-4 md:p-8">
							<HonestyPanel />
						</aside>
					</div>

					<Footer />
				</div>
			</div>
		</main>
	);
}

function Header() {
	return (
		<section className="relative isolate overflow-hidden">
			<Spotlight />

			<div className="relative grid items-center gap-8 p-4 md:p-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,32rem)] lg:gap-12 xl:py-12">
				<m.div
					className="space-y-5"
					initial={{ opacity: 0, y: 16 }}
					animate={{ opacity: 1, y: 0 }}
					transition={{ duration: 0.5, ease: EASE_OUT_STRONG }}
				>
					<h1 className="font-semibold text-4xl tracking-tight md:text-5xl">
						<Trans>ATS Checker</Trans>
					</h1>

					<p className="max-w-lg text-base text-muted-foreground leading-relaxed md:text-lg">
						<Trans>
							Upload a resume and see what an applicant tracking system reads from it. Everything runs in this browser.
							Your file is never uploaded, and nothing is stored.
						</Trans>
					</p>
				</m.div>

				<m.div
					initial={{ opacity: 0, y: 24 }}
					animate={{ opacity: 1, y: 0 }}
					transition={{ duration: 0.55, delay: 0.12, ease: EASE_OUT_STRONG }}
				>
					<ParsePreview />
				</m.div>
			</div>
		</section>
	);
}

function ToolSkeleton() {
	return (
		<div className="space-y-4">
			<Skeleton className="h-28 w-full" />
			<Skeleton className="h-24 w-full" />
		</div>
	);
}

type FactGroupProps = {
	icon: React.ReactNode;
	title: React.ReactNode;
	children: React.ReactNode;
};

function FactGroup({ icon, title, children }: FactGroupProps) {
	return (
		<div className="space-y-2.5">
			<h2 className="flex items-center gap-2 font-semibold text-sm tracking-tight">
				{icon}
				{title}
			</h2>
			{children}
		</div>
	);
}

/**
 * The honest framing, stated before the reader runs anything.
 *
 * Every claim here is one this tool can stand behind. The widely repeated "75% of resumes are
 * rejected by robots" figure traces back to marketing copy rather than research, and this page says
 * so instead of quietly trading on it.
 */
function HonestyPanel() {
	return (
		<>
			<FactGroup
				icon={<CheckCircleIcon className="size-4 shrink-0 text-emerald-600" />}
				title={<Trans>What this checks</Trans>}
			>
				<ul className="space-y-1.5 text-muted-foreground text-sm leading-relaxed">
					<li>
						<Trans>Whether the file holds real text, or a picture of it.</Trans>
					</li>
					<li>
						<Trans>Whether the text comes out in the order a person would read it.</Trans>
					</li>
					<li>
						<Trans>Whether your name, email, phone and dates survive intact.</Trans>
					</li>
					<li>
						<Trans>Whether the usual sections are there and can be told apart.</Trans>
					</li>
					<li>
						<Trans>Optionally, which terms from a job posting already appear.</Trans>
					</li>
				</ul>
			</FactGroup>

			<FactGroup
				icon={<ProhibitIcon className="size-4 shrink-0 text-rose-600" />}
				title={<Trans>What this does not do</Trans>}
			>
				<ul className="space-y-1.5 text-muted-foreground text-sm leading-relaxed">
					<li>
						<Trans>No prediction of whether you will be rejected. No tool can do that.</Trans>
					</li>
					<li>
						<Trans>No repeating the claim that most resumes are thrown out automatically.</Trans>
					</li>
					<li>
						<Trans>No one-page rule, and no treating a font or a career gap as a fault.</Trans>
					</li>
				</ul>
			</FactGroup>

			<FactGroup
				icon={<ShieldCheckIcon className="size-4 shrink-0 text-sky-600" />}
				title={<Trans>Your file stays here</Trans>}
			>
				<p className="text-muted-foreground text-sm leading-relaxed">
					<Trans>
						The PDF is read by code running in this tab. Nothing is uploaded, nothing is stored, and no account is
						needed. Open your browser's network tab and watch, if you like.
					</Trans>
				</p>
			</FactGroup>
		</>
	);
}
