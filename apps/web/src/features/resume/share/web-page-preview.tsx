import type { PageMap } from "@reactive-resume/pdf/page-map";
import type { ResumeData } from "@reactive-resume/schema/resume/data";
import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useEffect, useState } from "react";
import { useDebounceValue } from "usehooks-ts";
import { renderResumeWebPage, webPageImageUrl } from "@reactive-resume/pdf/web-page";
import { renderWebPageDocument, webPageMessages } from "@reactive-resume/pdf/web-page-document";
import { removeContactDetails } from "@reactive-resume/resume/contact-details";
import { publicResumeUrl } from "@reactive-resume/resume/sharing";
import { Icon } from "@reactive-resume/ui/components/icon";
import { SegmentedControl, SegmentedControlItem } from "@reactive-resume/ui/components/segmented-control";
import { Spinner } from "@reactive-resume/ui/components/spinner";
import { cn } from "@reactive-resume/utils/style";
import { useSharePreviewStore } from "./privacy-preview";
import { useShareOrigin } from "./use-share-origin";
import { useCurrentResume, useResumeData } from "@/features/resume/builder/draft";
import { ZoomBar } from "@/features/resume/editor/chrome";
import { useEditorStore } from "@/features/resume/editor/store";
import { createResumePdfBlob } from "@/features/resume/export/pdf-document";
import { authClient } from "@/libs/auth/client";
import { getFontMirrorUrl } from "@/libs/font-source";
// The page's own text, declared for translators; see the module.
import "./web-page-text";

type Device = "desktop" | "phone";

type PreviewSettings = {
	hideContactDetails: boolean;
	showDownloadButtons: boolean;
	allowWordDownload: boolean;
	contactDetails: boolean;
};

/** The page a visitor gets, from the draft: same renderer as the server, contact details hidden as they'd be. */
async function renderPreview(data: ResumeData, settings: PreviewSettings, fontMirrorUrl: string | undefined) {
	let visible = data;
	if (settings.hideContactDetails) {
		visible = structuredClone(data);
		removeContactDetails(visible);
	}
	const page = await renderResumeWebPage({
		data: visible,
		imageUrl: webPageImageUrl(window.location.origin),
		fontMirrorUrl,
	});
	return renderWebPageDocument({
		page,
		messages: webPageMessages(visible.metadata.page.locale),
		// The preview is inert (no scripts, no requests); these only decide which controls show.
		downloadUrl: settings.showDownloadButtons ? "#" : undefined,
		wordDownloadUrl: settings.allowWordDownload ? "#" : undefined,
		creditUrl: data.metadata.web?.showCredit === false ? undefined : window.location.origin,
		// The visitor's bar would look live here (Copy link, Download PDF); the frame names the address instead.
	}).replace(
		"</head>",
		`<style>.rr-bar{display:none!important}${settings.contactDetails ? `.rr [data-contact-detail]{outline:1px dashed ${getComputedStyle(document.documentElement).getPropertyValue("--warn-mark")};outline-offset:3px}` : ""}</style></head>`,
	);
}

/**
 * Share's canvas: the web page as visitors see it, at a computer's width or a phone's. It follows the draft, so
 * Design changes show here before they're saved.
 */
export function WebPagePreview() {
	const data = useResumeData();
	const resume = useCurrentResume();
	const contactDetails = useSharePreviewStore((state) => state.contactDetails);
	const [device, setDevice] = useState<Device>("desktop");
	const [document, setDocument] = useState<string>();

	const hideContactDetails = resume.hideContactDetails ?? false;
	const showDownloadButtons = resume.showDownloadButtons !== false;
	const allowWordDownload = resume.allowWordDownload === true;

	// Typing renders once it pauses, not on every keystroke.
	const [debouncedData] = useDebounceValue(data, 200);
	const fontMirrorUrl = getFontMirrorUrl();
	useEffect(() => {
		if (!debouncedData) return;
		let current = true;
		let pageMap: PageMap | undefined;
		void createResumePdfBlob(debouncedData, undefined, {
			onPageMap: (map) => {
				pageMap = map;
			},
		})
			.then((file) => {
				if (current && pageMap)
					useEditorStore.getState().setRendered({ pageCount: pageMap.pages.length, pageMap, file });
			})
			.catch(() => undefined);
		return () => {
			current = false;
		};
	}, [debouncedData]);

	useEffect(() => {
		if (!debouncedData) return;
		let current = true;
		void renderPreview(
			debouncedData,
			{ hideContactDetails, showDownloadButtons, allowWordDownload, contactDetails },
			fontMirrorUrl,
		)
			.then((html) => {
				if (current) setDocument(html);
			})
			.catch(() => undefined);
		return () => {
			current = false;
		};
	}, [debouncedData, hideContactDetails, showDownloadButtons, allowWordDownload, fontMirrorUrl, contactDetails]);

	const { data: session } = authClient.useSession();
	const origin = useShareOrigin();
	const address = publicResumeUrl(origin, { username: session?.user.username ?? "", slug: resume.slug }).replace(
		/^https?:\/\//,
		"",
	);
	const isPublic = resume.isPublic ?? false;
	// The corner zoom, as on the page canvas; "fit" is the page at its own width.
	const zoom = useEditorStore((state) => state.zoom);
	const scale = zoom === "fit" ? 1 : zoom;

	return (
		<div
			data-design="canvas"
			className="relative flex h-full min-h-0 flex-col items-center bg-sunken px-4 pt-4 dark:bg-raised"
		>
			<SegmentedControl
				aria-label={t`Preview size`}
				value={device}
				onValueChange={(value) => setDevice(value as Device)}
				className="shrink-0"
			>
				<SegmentedControlItem value="desktop">
					<Icon name="desktop" />
					<Trans>Computer</Trans>
				</SegmentedControlItem>
				<SegmentedControlItem value="phone">
					<Icon name="device-mobile" />
					<Trans>Phone</Trans>
				</SegmentedControlItem>
			</SegmentedControl>
			{/* A browser window, cut by the canvas's lower edge: its bar names the address the page opens at. */}
			<div
				className={cn(
					"mt-4 flex min-h-0 w-full flex-1 flex-col overflow-hidden rounded-t-xl border border-b-0 border-line bg-bg shadow-e2 transition-[max-width] duration-standard ease-enter",
					device === "phone" ? "max-w-[390px]" : "max-w-[880px]",
				)}
			>
				<div className="relative flex h-11 shrink-0 items-center gap-1.5 border-b border-line bg-surface px-4">
					<b className="size-2.5 rounded-full bg-line-2" />
					<b className="size-2.5 rounded-full bg-line-2" />
					<b className="size-2.5 rounded-full bg-line-2" />
					<span
						dir="ltr"
						className="absolute start-1/2 flex h-7 max-w-[calc(100%-96px)] -translate-x-1/2 items-center gap-1.5 truncate rounded-sm bg-sunken px-3 t-mono text-ink-2 rtl:translate-x-1/2"
					>
						<Icon name="lock-simple" size={14} />
						{address}
					</span>
				</div>
				<div className="relative min-h-0 flex-1">
					{!isPublic ? (
						<div className="grid size-full place-items-center p-6 text-center">
							<div className="grid justify-items-center gap-1.5">
								<Icon name="eye-slash" size={20} className="text-ink-3" />
								<p className="text-sm font-medium text-ink">
									<Trans>Only you can see this page</Trans>
								</p>
								<p className="t-small text-ink-3">
									<Trans>Turn Public link on to share it.</Trans>
								</p>
							</div>
						</div>
					) : document ? (
						// Sandboxed without scripts: links open in a new tab, nothing on the page runs or calls out.
						<iframe
							title={t`Web page preview`}
							srcDoc={document}
							sandbox="allow-popups allow-popups-to-escape-sandbox"
							className="origin-top-left border-0 rtl:origin-top-right"
							style={{ width: `${100 / scale}%`, height: `${100 / scale}%`, transform: `scale(${scale})` }}
						/>
					) : (
						<div className="grid size-full place-items-center">
							<Spinner className="size-6" />
						</div>
					)}
				</div>
			</div>
			{isPublic && <ZoomBar fitScale={1} />}
		</div>
	);
}
