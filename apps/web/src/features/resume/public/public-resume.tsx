import type { ResumeData } from "@reactive-resume/schema/resume/data";
import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useQuery } from "@tanstack/react-query";
import { getRouteApi } from "@tanstack/react-router";
import { useMemo } from "react";
import { useCopyToClipboard } from "usehooks-ts";
import { Button } from "@reactive-resume/ui/components/button";
import { Icon } from "@reactive-resume/ui/components/icon";
import { toast } from "@reactive-resume/ui/components/toast";
import { useBreakpoint } from "@reactive-resume/ui/hooks/use-breakpoint";
import { PdfViewer } from "./pdf-viewer";
import { ResumeReflow } from "./resume-reflow";
import { LoadingScreen } from "@/components/layout/loading-screen";
import { useResumeExport } from "@/features/resume/export/use-resume-export";
import { CopyLinkButton } from "@/features/resume/share/copy-link-button";
import { POP_CLASS } from "@/libs/motion";
import { orpc } from "@/libs/orpc/client";

const publicResumeRoute = getRouteApi("/$username/$slug");

export function PublicResumeRoute() {
	const { username, slug } = publicResumeRoute.useParams();
	const { flags } = publicResumeRoute.useRouteContext();

	const { data: resume } = useQuery(orpc.resume.getBySlug.queryOptions({ input: { username, slug } }));
	return <PublicResumePage resume={resume} username={username} slug={slug} flags={flags} />;
}

type PublicResumePageProps = {
	resume: { id?: string; name: string; slug: string; data: ResumeData; showDownloadButtons?: boolean } | undefined;
	username: string;
	slug: string;
	flags: { disableSignups: boolean };
	isRoot?: boolean;
};

/**
 * The shared resume, for recruiters: no app chrome, the owner's name leads, and Download PDF is the one action. On
 * phones it reflows into readable text with Download pinned; with downloads off, Download is gone and printing shows
 * a note instead of the page.
 */
export function PublicResumePage({ resume, username, slug, flags, isRoot = false }: PublicResumePageProps) {
	const publicResume = useMemo(() => ({ username, slug }), [slug, username]);
	const { onDownloadPDF, isExporting } = useResumeExport(resume, resume ? { publicResumePdf: { publicResume } } : {});
	const phone = useBreakpoint() === "mobile";
	const [, copy] = useCopyToClipboard();

	if (!resume) return <LoadingScreen />;

	const { basics } = resume.data;
	const downloads = resume.showDownloadButtons !== false;
	const subtitle = [basics.headline, basics.location].filter(Boolean).join(" · ");

	const share = async () => {
		const title = basics.name || resume.name;
		if (typeof navigator.share === "function") {
			try {
				await navigator.share({ title, url: window.location.href });
			} catch {
				// Closing the share sheet isn't an error.
			}
			return;
		}
		await copy(window.location.href);
		toast.add({ description: t`Link copied` });
	};

	const download = (
		<Button
			onClick={() => void onDownloadPDF()}
			loading={isExporting}
			className={phone ? "h-12 flex-1 text-base" : undefined}
		>
			{!isExporting && <Icon name="download" size={phone ? 20 : 18} className={POP_CLASS} />}
			<Trans>Download PDF</Trans>
		</Button>
	);

	const credit = (
		<footer className="flex justify-center px-4 py-6 text-sm text-ink-3 print:hidden">
			{flags.disableSignups ? (
				<Trans>Made with Reactive Resume, free and open source</Trans>
			) : (
				<a href={isRoot ? "/dashboard" : "/"} className="underline-offset-2 hover:text-ink hover:underline">
					<Trans>Made with Reactive Resume, free and open source</Trans>
				</a>
			)}
		</footer>
	);

	return (
		<div className="flex min-h-svh flex-col bg-sunken print:block print:min-h-0 print:bg-white">
			{/* Printing is part of downloading: when the owner turns downloads off, print shows this note. */}
			{!downloads && (
				<p className="hidden p-8 text-center text-sm print:block">
					<Trans>Printing is turned off for this resume.</Trans>
				</p>
			)}

			<div className={downloads ? "contents" : "contents print:hidden"}>
				{phone ? (
					<>
						<main id="main-content" className="flex-1">
							<h1 className="sr-only">{basics.name || resume.name}</h1>
							<ResumeReflow data={resume.data} />
							{credit}
						</main>
						<div className="sticky bottom-0 flex gap-2 border-t border-line bg-surface px-4 pt-3 pb-[max(1.5rem,env(safe-area-inset-bottom))] print:hidden">
							{downloads && download}
							<Button
								variant="secondary"
								size="icon-lg"
								className={downloads ? "size-12" : "h-12 flex-1"}
								aria-label={t`Share`}
								onClick={() => void share()}
							>
								<Icon name="ios_share" size={22} />
								{!downloads && <Trans>Share</Trans>}
							</Button>
						</div>
					</>
				) : (
					<>
						<header className="sticky top-0 z-10 flex h-16 items-center gap-3 border-b border-line bg-surface px-5 print:hidden">
							<div className="grid min-w-0 flex-1">
								<h1 className="truncate font-display text-xl leading-6 font-medium">{basics.name || resume.name}</h1>
								{subtitle && <p className="truncate text-xs text-ink-3">{subtitle}</p>}
							</div>
							<CopyLinkButton url={window.location.href} label={t`Copy link`} icon="link" />
							{downloads && download}
						</header>
						<main id="main-content" className="flex flex-1 justify-center px-6 pt-8 pb-5 print:block print:p-0">
							<div className="w-full max-w-[860px] bg-white shadow-e2 print:max-w-full print:shadow-none">
								<PdfViewer data={resume.data} className="block w-full" publicResume={publicResume} />
							</div>
						</main>
						{credit}
					</>
				)}
			</div>
		</div>
	);
}

/** Off, unknown or trashed links read the same, with nothing about the owner. */
export function SharedResumeUnavailable() {
	return (
		<main id="main-content" className="grid min-h-svh place-items-center bg-sunken px-6 text-center">
			<div className="grid max-w-sm gap-2">
				<h1 className="font-display text-[26px] leading-8 font-medium">
					<Trans>This resume isn't shared right now.</Trans>
				</h1>
				<p className="text-sm text-ink-2">
					<Trans>If someone sent you this link, ask them for a new one.</Trans>
				</p>
			</div>
		</main>
	);
}
