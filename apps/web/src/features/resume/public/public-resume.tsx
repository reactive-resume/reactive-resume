import type { ResumeData } from "@reactive-resume/schema/resume/data";
import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { CircleNotchIcon, DownloadSimpleIcon } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { getRouteApi } from "@tanstack/react-router";
import { useMemo } from "react";
import { BrandIcon } from "@reactive-resume/ui/components/brand-icon";
import { Button } from "@reactive-resume/ui/components/button";
import { LoadingScreen } from "@/components/layout/loading-screen";
import { useResumeExport } from "@/features/resume/export/use-resume-export";
import { orpc } from "@/libs/orpc/client";
import { PdfViewer } from "./pdf-viewer";

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

export function PublicResumePage({ resume, username, slug, flags, isRoot = false }: PublicResumePageProps) {
	const publicResume = useMemo(() => ({ username, slug }), [slug, username]);
	const { onDownloadPDF, isExporting } = useResumeExport(resume, {
		...(resume ? { publicResumePdf: { publicResume } } : {}),
	});

	if (!resume) return <LoadingScreen />;

	const { basics, picture } = resume.data;
	const showDownloadButtons = resume.showDownloadButtons !== false;

	return (
		<>
			<div className="mx-auto flex w-full flex-col items-center gap-6 px-4 py-6 print:m-0 print:block print:max-w-full print:p-0">
				<header className="flex w-full max-w-5xl flex-col items-center gap-4 text-center print:hidden">
					{picture.url && !picture.hidden && (
						<img src={picture.url} alt={basics.name} className="size-20 rounded-full object-cover shadow-sm" />
					)}
					<div className="space-y-1">
						{basics.name && <h1 className="font-semibold text-2xl tracking-tight">{basics.name}</h1>}
						{basics.headline && <p className="text-muted-foreground">{basics.headline}</p>}
					</div>
					{showDownloadButtons && (
						<Button onClick={() => void onDownloadPDF()} disabled={isExporting}>
							{isExporting ? (
								<CircleNotchIcon className="size-4 animate-spin" />
							) : (
								<DownloadSimpleIcon className="size-4" />
							)}
							<Trans>Download PDF</Trans>
						</Button>
					)}
				</header>

				<main id="main-content" className="w-full max-w-5xl bg-white print:max-w-full">
					<PdfViewer data={resume.data} className="block w-full" publicResume={publicResume} />
				</main>

				{!flags.disableSignups && (
					<footer className="flex justify-center print:hidden">
						<a
							href={isRoot ? "/dashboard" : "/"}
							className="flex items-center gap-2 text-muted-foreground text-sm transition-colors hover:text-foreground"
						>
							<BrandIcon variant="icon" className="size-5" />
							<Trans>Build your own resume</Trans>
						</a>
					</footer>
				)}
			</div>

			{showDownloadButtons && (
				<Button
					size="icon-lg"
					variant="outline"
					disabled={isExporting}
					onClick={() => void onDownloadPDF()}
					aria-label={t`Download PDF`}
					title={t`Download PDF`}
					className="fixed right-6 bottom-6 z-50 rounded-full bg-background/95 opacity-70 shadow-lg backdrop-blur transition-[opacity,scale] duration-150 ease-out-strong hover:opacity-100 print:hidden"
				>
					{isExporting ? (
						<CircleNotchIcon className="size-5 animate-spin" />
					) : (
						<DownloadSimpleIcon className="size-5" />
					)}
				</Button>
			)}
		</>
	);
}
