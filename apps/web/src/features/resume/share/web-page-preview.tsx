import type { ResumeData } from "@reactive-resume/schema/resume/data";
import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useEffect, useState } from "react";
import { renderResumeWebPage } from "@reactive-resume/pdf/web-page";
import { renderWebPageDocument, webPageMessages } from "@reactive-resume/pdf/web-page-document";
import { removeContactDetails } from "@reactive-resume/resume/contact-details";
import { getResumeSocialMeta } from "@reactive-resume/resume/social-meta";
import { Icon } from "@reactive-resume/ui/components/icon";
import { SegmentedControl, SegmentedControlItem } from "@reactive-resume/ui/components/segmented-control";
import { Spinner } from "@reactive-resume/ui/components/spinner";
import { cn } from "@reactive-resume/utils/style";
import { useCurrentResume, useResumeData } from "@/features/resume/builder/draft";
// The page's own text, declared for translators; see the module.
import "./web-page-text";

type Device = "desktop" | "phone";

type PreviewSettings = {
	hideContactDetails: boolean;
	showContactButton: boolean;
	showDownloadButtons: boolean;
};

/** The page a visitor gets, from the draft: same renderer as the server, contact details hidden as they'd be. */
async function renderPreview(data: ResumeData, settings: PreviewSettings) {
	const visible = structuredClone(data);
	if (settings.hideContactDetails) removeContactDetails(visible);
	const page = await renderResumeWebPage({
		data: visible,
		imageUrl: (source) =>
			source.startsWith("/")
				? `${window.location.origin}${source}`
				: /^(https?:|data:image\/)/i.test(source)
					? source
					: undefined,
	});
	const social = getResumeSocialMeta(visible);
	return renderWebPageDocument({
		page,
		messages: webPageMessages(visible.metadata.page.locale),
		head: {
			title: social.title,
			description: social.description,
			canonicalUrl: window.location.href,
			indexable: false,
		},
		// The preview is inert (no scripts, no requests); these only decide which controls show.
		downloadUrl: settings.showDownloadButtons ? "#" : undefined,
		contactUrl: settings.hideContactDetails && settings.showContactButton ? "#" : undefined,
		creditUrl: data.metadata.web?.showCredit === false ? undefined : window.location.origin,
	});
}

/**
 * Share's canvas: the web page as visitors see it, at a computer's width or a phone's. It follows the draft, so
 * Design changes show here before they're saved.
 */
export function WebPagePreview() {
	const data = useResumeData();
	const resume = useCurrentResume();
	const [device, setDevice] = useState<Device>("desktop");
	const [document, setDocument] = useState<string>();

	const hideContactDetails = resume.hideContactDetails ?? false;
	const showContactButton = resume.showContactButton !== false;
	const showDownloadButtons = resume.showDownloadButtons !== false;

	useEffect(() => {
		if (!data) return;
		let current = true;
		// Typing renders once it pauses, not on every keystroke.
		const timer = setTimeout(() => {
			void renderPreview(data, { hideContactDetails, showContactButton, showDownloadButtons })
				.then((html) => {
					if (current) setDocument(html);
				})
				.catch(() => undefined);
		}, 200);
		return () => {
			current = false;
			clearTimeout(timer);
		};
	}, [data, hideContactDetails, showContactButton, showDownloadButtons]);

	return (
		<div className="flex h-full min-h-0 flex-col items-center gap-3 bg-sunken p-4">
			<SegmentedControl
				aria-label={t`Preview size`}
				value={device}
				onValueChange={(value) => setDevice(value as Device)}
				className="shrink-0"
			>
				<SegmentedControlItem value="desktop">
					<Icon name="desktop" size={16} />
					<Trans>Computer</Trans>
				</SegmentedControlItem>
				<SegmentedControlItem value="phone">
					<Icon name="device-mobile" size={16} />
					<Trans>Phone</Trans>
				</SegmentedControlItem>
			</SegmentedControl>
			<div
				className={cn(
					"relative min-h-0 w-full flex-1 overflow-hidden rounded-lg border border-line bg-bg shadow-e1 transition-[max-width] duration-standard ease-enter",
					device === "phone" ? "max-w-[390px]" : "max-w-full",
				)}
			>
				{document ? (
					// Sandboxed without scripts: links open in a new tab, nothing on the page runs or calls out.
					<iframe
						title={t`Web page preview`}
						srcDoc={document}
						sandbox="allow-popups allow-popups-to-escape-sandbox"
						className="size-full border-0"
					/>
				) : (
					<div className="grid size-full place-items-center">
						<Spinner className="size-6" />
					</div>
				)}
			</div>
		</div>
	);
}
