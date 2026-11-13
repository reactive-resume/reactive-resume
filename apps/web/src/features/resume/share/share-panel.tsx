import type { ReactNode } from "react";
import { t } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import { Trans } from "@lingui/react/macro";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouteContext } from "@tanstack/react-router";
import { QRCodeSVG } from "qrcode.react";
import { useEffect, useId, useRef, useState } from "react";
import {
	formatTimeSince,
	publicResumeUrl,
	shareListState,
	shortLinkOpens,
	summarizeViews,
} from "@reactive-resume/resume/sharing";
import { Button } from "@reactive-resume/ui/components/button";
import { Icon } from "@reactive-resume/ui/components/icon";
import { Popover, PopoverContent, PopoverTrigger } from "@reactive-resume/ui/components/popover";
import { Switch } from "@reactive-resume/ui/components/switch";
import { toast } from "@reactive-resume/ui/components/toast";
import { downloadWithAnchor } from "@reactive-resume/utils/file";
import { cn } from "@reactive-resume/utils/style";
import { AddressField } from "./address-field";
import { CopyLinkButton } from "./copy-link-button";
import { CustomDomainField } from "./custom-domain-field";
import { FeedbackLinksSection } from "./feedback-links";
import { useSharePreviewStore } from "./privacy-preview";
import { useShareOrigin } from "./use-share-origin";
import { Crumb, CrumbButton } from "@/components/calm/crumb";
import { List, ListRow, rowGroundClassName } from "@/components/calm/list-row";
import { SectionHeading } from "@/components/calm/section-heading";
import {
	useCurrentResume,
	useIsResumeLocked,
	usePatchResume,
	saveResumeMetadata,
	useResumeData,
	useUpdateResumeData,
} from "@/features/resume/builder/draft";
import { ResumePasswordDialog } from "@/features/resume/builder/password-dialog";
import { PanelBody, PanelHeader } from "@/features/resume/editor/chrome/panel";
import { useEditorStore } from "@/features/resume/editor/store";
import { useConfirm } from "@/hooks/use-confirm";
import { authClient } from "@/libs/auth/client";
import { toastError } from "@/libs/error-message";
import { ENTER_CLASS } from "@/libs/motion";
import { orpc } from "@/libs/orpc/client";

const toastShareError = (error: unknown) =>
	toastError(error, t`Couldn't update sharing. Try again.`, { allowServerMessage: true });

type ShareView = "share" | "privacy" | "domain" | "feedback";

/**
 * Share: the web page and everything about who sees what (B5). The first level holds the public link, the visitors
 * and two rows that open Privacy and downloads (B27) and Short link and domain (B28); feedback links have their own
 * level too. Private is the default; turning the link off keeps the address.
 */
export function SharePanel() {
	useEffect(() => () => useSharePreviewStore.setState({ contactDetails: false }), []);
	const [view, setView] = useState<ShareView>("share");
	const setting = useShareSetting();
	const back = () => setView("share");

	return (
		<PanelBody data-share-view={view} className={cn("pb-6", view !== "share" && "pt-3.5")}>
			{view === "share" && <ShareHome setting={setting} open={setView} />}
			{view === "privacy" && (
				<ShareSubPage
					title={<Trans>Privacy and downloads</Trans>}
					description={<Trans>Who can find your web page, reach you from it and take a copy.</Trans>}
					onBack={back}
					next={{ label: <Trans>Short link and domain</Trans>, onClick: () => setView("domain") }}
				>
					<PrivacySettings setting={setting} />
				</ShareSubPage>
			)}
			{view === "domain" && <DomainPage setting={setting} onBack={back} onNext={() => setView("privacy")} />}
			{view === "feedback" && <FeedbackPage onBack={back} />}
		</PanelBody>
	);
}

type ShareHomeProps = { setting: ShareSetting; open: (view: ShareView) => void };

/** B5: the public link, its address, the visitors and the ways into the web page's settings. */
function ShareHome({ setting, open }: ShareHomeProps) {
	const resume = useCurrentResume();
	const { data: session } = authClient.useSession();
	const { update, isPending } = setting;
	const isPublic = resume.isPublic ?? false;
	// shortcut: publication history lasts for this editor session; durable history needs an owner API field.
	const hasPublished = useEditorStore((state) => isPublic || state.publishedResumeId === resume.id);
	const origin = useShareOrigin();
	const username = session?.user.username ?? "";
	const url = publicResumeUrl(origin, { username, slug: resume.slug });

	const setPublic = async (checked: boolean) => {
		const done = await update({ isPublic: checked });
		if (done) {
			if (checked) useEditorStore.setState({ publishedResumeId: resume.id });
			toast.add({ description: checked ? t`Your web page is live` : t`Link turned off. The address is kept` });
		}
	};

	return (
		<>
			{hasPublished ? (
				<>
					<SectionHeading first className="items-center">
						<Trans>Public link</Trans>
						<Switch
							className="ms-auto"
							checked={isPublic}
							aria-label={t`Public link`}
							disabled={isPending || resume.isLocked}
							onCheckedChange={(checked) => void setPublic(checked)}
						/>
					</SectionHeading>
					<p className="t-small text-ink-3">
						{!isPublic
							? t`Off. Only you can see your web page.`
							: resume.hasPassword
								? t`Visitors need the link and password to see your web page.`
								: t`Anyone with the link can see your web page.`}
					</p>
				</>
			) : (
				<div className="grid gap-3 rounded-xl border border-line p-3.5">
					<div className="grid gap-1">
						<h2 className="text-sm font-semibold">
							<Trans>Your resume as a web page</Trans>
						</h2>
						<p className="t-small text-ink-2">
							<Trans>Publish it to share a link that opens on any screen. Only you can see it until then.</Trans>
						</p>
					</div>
					<Button
						variant="secondary"
						className="w-fit"
						disabled={isPending || resume.isLocked}
						onClick={() => void setPublic(true)}
					>
						<Icon name="globe-hemisphere-west" />
						<Trans>Publish</Trans>
					</Button>
				</div>
			)}

			{hasPublished && (
				<>
					<AddressField
						url={url}
						username={username}
						update={update}
						className={isPublic ? "mt-4" : "mt-5"}
						actions={(copyDisabled) =>
							isPublic && (
								<div className={cn(ENTER_CLASS, "mt-3.5 flex flex-wrap items-center gap-5")}>
									<CopyLinkButton url={url} disabled={copyDisabled} />
									<a href={url} target="_blank" rel="noopener" className={textLinkClassName}>
										<Trans>Open web page</Trans>
									</a>
									<QrCodeButton url={url} />
								</div>
							)
						}
					/>

					<ViewsAndDownloads isPublic={isPublic} />
					<div inert={!isPublic} className={cn(!isPublic && "opacity-50")}>
						<FeedbackRow onOpen={() => open("feedback")} />

						<SectionHeading className="pt-6">
							<Trans>Web page</Trans>
						</SectionHeading>
						<List role="navigation" aria-label={t`Web page settings`}>
							<ListRow
								render={<button type="button" onClick={() => open("privacy")} />}
								title={<Trans>Privacy and downloads</Trans>}
								subtitle={<PrivacySummary />}
								caret
							/>
							<ListRow
								render={<button type="button" onClick={() => open("domain")} />}
								title={<AddressesTitle />}
								subtitle={<AddressesSummary origin={origin} username={username} />}
								caret
							/>
						</List>
					</div>
				</>
			)}
		</>
	);
}

const textLinkClassName =
	"inline-flex items-center gap-1.5 rounded-xs text-sm font-medium text-accent-text [--icon-size:16px] hover:underline underline-offset-4";

/** Two quiet lines: what the privacy settings are now. */
function PrivacySummary() {
	const resume = useCurrentResume();
	return (
		<>
			<span>
				{resume.hideContactDetails ? t`Contact details hidden` : t`Contact details shown`}
				{" · "}
				{resume.hasPassword ? t`password set` : t`no password`}
			</span>
			<br />
			<span>
				{resume.showDownloadButtons !== false ? t`PDF download on` : t`PDF download off`}
				{" · "}
				{resume.allowWordDownload === true ? t`Word on` : t`Word off`}
			</span>
		</>
	);
}

function AddressesTitle() {
	const { flags } = useRouteContext({ strict: false });
	return flags?.customDomains ? <Trans>Short link and domain</Trans> : <Trans>Short link</Trans>;
}

/** Two quiet lines: what the short link opens, and where the custom domain stands. */
function AddressesSummary({ origin, username }: { origin: string; username: string }) {
	const resume = useCurrentResume();
	const { flags } = useRouteContext({ strict: false });
	const domains = flags?.customDomains ?? false;
	const { data: resumes } = useQuery(orpc.resume.list.queryOptions());
	const { data: domain } = useQuery({ ...orpc.customDomain.get.queryOptions(), enabled: domains });
	const current = resumes?.find((item) => item.isPrimary && item.id !== resume.id);
	const shortLink = publicResumeUrl(origin, { username, slug: resume.slug, isPrimary: true }).replace(
		/^https?:\/\//,
		"",
	);

	return (
		<>
			<span dir="auto">
				{resume.isPrimary
					? t`${shortLink} opens this resume`
					: current
						? t`${shortLink} opens “${current.name}”`
						: t`${shortLink} opens no resume yet`}
			</span>
			{domains && <br />}
			{domains && (
				<span>
					{domain
						? domain.verified
							? t`${domain.hostname} is connected`
							: t`${domain.hostname} is not connected yet`
						: t`No custom domain`}
				</span>
			)}
		</>
	);
}

type ShareSubPageProps = {
	title: ReactNode;
	description: ReactNode;
	onBack: () => void;
	/** The sibling page, offered at the crumb line's end. */
	next?: { label: ReactNode; onClick: () => void };
	children: ReactNode;
};

/** A second level of Share (B27, B28): the crumb back to Share, the sibling page, a title and its one quiet line. */
function ShareSubPage({ title, description, onBack, next, children }: ShareSubPageProps) {
	return (
		<>
			<PanelHeader
				crumb={
					<div className="flex w-full items-center justify-between">
						<Crumb>
							<CrumbButton onClick={onBack}>
								<Trans>Share</Trans>
							</CrumbButton>
						</Crumb>
						{next && (
							<button
								type="button"
								onClick={next.onClick}
								className="inline-flex h-7 items-center gap-1 rounded-xs text-[13px]/[18px] font-medium text-ink-3 transition-colors hover:text-ink"
							>
								{next.label}
								<Icon name="arrow-right" size={16} className="rtl:-scale-x-100" />
							</button>
						)}
					</div>
				}
				title={title}
			/>
			<p className="mt-0.5 t-small text-ink-3">{description}</p>
			{children}
		</>
	);
}

type SettingRowProps = {
	label: ReactNode;
	description?: ReactNode;
	checked: boolean;
	disabled?: boolean;
	onCheckedChange: (checked: boolean) => void;
	previewContactDetails?: boolean;
	/** Controls under the description (a password's Change). */
	children?: ReactNode;
};

/** A Share setting: a 15px name, the app's sentence under it and the switch at the end, rows split by hairlines. */
function SettingRow({
	label,
	description,
	checked,
	disabled,
	onCheckedChange,
	children,
	previewContactDetails,
}: SettingRowProps) {
	const id = useId();
	return (
		<div
			onPointerEnter={previewContactDetails ? () => useSharePreviewStore.setState({ contactDetails: true }) : undefined}
			onPointerLeave={
				previewContactDetails ? () => useSharePreviewStore.setState({ contactDetails: false }) : undefined
			}
			onFocusCapture={previewContactDetails ? () => useSharePreviewStore.setState({ contactDetails: true }) : undefined}
			onBlurCapture={previewContactDetails ? () => useSharePreviewStore.setState({ contactDetails: false }) : undefined}
			className={cn(
				rowGroundClassName,
				"flex min-h-14 items-start gap-3.5 border-b border-line pt-3 pb-3.5 before:-inset-x-3 last:border-b-0 hover:before:bg-hover has-[:focus-visible]:before:bg-hover",
			)}
		>
			<span className="relative flex min-w-0 flex-1 flex-col gap-0.5">
				<span id={`${id}-label`} className="text-[15px]/[22px] font-medium text-ink">
					{label}
				</span>
				{description && (
					<span id={`${id}-description`} className="t-small text-ink-3">
						{description}
					</span>
				)}
				{children}
			</span>
			<Switch
				checked={checked}
				disabled={disabled}
				onCheckedChange={onCheckedChange}
				aria-labelledby={`${id}-label`}
				aria-describedby={description ? `${id}-description` : undefined}
				className="relative mt-px"
			/>
		</div>
	);
}

function SubHeading({ children }: { children: ReactNode }) {
	return <h3 className="pt-[22px] pb-2 t-section-title">{children}</h3>;
}

type ShareSettings = {
	isPublic?: boolean;
	showDownloadButtons?: boolean;
	allowWordDownload?: boolean;
	showInSearchEngines?: boolean;
	hideContactDetails?: boolean;
	isPrimary?: boolean;
	slug?: string;
};

type ShareSetting = ReturnType<typeof useShareSetting>;

/**
 * Saves Share settings that live beside the resume, not in it, and mirrors the result into the open draft. Share
 * makes one, so every switch is disabled while any of them saves.
 */
function useShareSetting() {
	const resume = useCurrentResume();
	const queryClient = useQueryClient();
	const options = orpc.resume.update.mutationOptions();
	const { mutateAsync: updateResume, isPending } = useMutation({
		...options,
		mutationFn: (value) =>
			saveResumeMetadata(value.id, (expectedUpdatedAt, options) =>
				orpc.resume.update.call({ ...value, expectedUpdatedAt }, options),
			),
	});

	const update = async (settings: ShareSettings) => {
		try {
			const updated = await updateResume({ id: resume.id, ...settings });
			// Another resume may have handed over its primary role, or publishing made this one primary.
			if (settings.isPrimary || updated.isPrimary !== resume.isPrimary)
				void queryClient.invalidateQueries({ queryKey: orpc.resume.list.key() });
			return true;
		} catch (error) {
			toastShareError(error);
			return false;
		}
	};

	return { update, isPending };
}

type DomainPageProps = { setting: ShareSetting; onBack: () => void; onNext: () => void };

/** B28: the short link (`/<username>`) and custom domain, both opening the primary resume. */
function DomainPage({ setting, onBack, onNext }: DomainPageProps) {
	const resume = useCurrentResume();
	const { data: session } = authClient.useSession();
	const origin = useShareOrigin();
	const username = session?.user.username ?? "";
	const { flags } = useRouteContext({ strict: false });
	const domains = flags?.customDomains ?? false;
	const { data: resumes, isPending, isError } = useQuery(orpc.resume.list.queryOptions());
	const current = resumes?.find((item) => item.isPrimary && item.id !== resume.id);
	const listState = shareListState({ isPending, isError });
	const shortLink = publicResumeUrl(origin, { username, slug: resume.slug, isPrimary: true });
	// The short link opens the primary resume only while it's published; at any other time it would copy a dead link.
	const opens = shortLinkOpens({
		isPrimary: resume.isPrimary ?? false,
		isPublic: resume.isPublic ?? false,
		listState,
		otherPrimaryIsPublic: current?.isPublic,
	});

	return (
		<ShareSubPage
			title={domains ? <Trans>Short link and domain</Trans> : <Trans>Short link</Trans>}
			description={
				domains ? (
					<Trans>Two shorter addresses. Both open your primary resume.</Trans>
				) : (
					<Trans>A shorter address that opens your primary resume.</Trans>
				)
			}
			onBack={onBack}
			next={{ label: <Trans>Privacy and downloads</Trans>, onClick: onNext }}
		>
			<section aria-labelledby="share-addresses-title" className="mt-2 flex flex-col">
				<h3 id="share-addresses-title" className="sr-only">
					{domains ? <Trans>Short link and domain</Trans> : <Trans>Short link</Trans>}
				</h3>
				<PrimaryRow setting={setting} current={current} listState={listState} domains={domains} />
				<div className="flex items-center justify-between gap-3 border-b border-line py-3">
					<span className="flex min-w-0 flex-col">
						<span className="text-xs/4 text-ink-3">
							<Trans>Short link</Trans>
						</span>
						<span className="truncate font-mono text-[13px]/5 font-medium text-ink" dir="ltr">
							{shortLink.replace(/^https?:\/\//, "")}
						</span>
					</span>
					<CopyLinkButton url={shortLink} disabled={!opens} size="sm" />
				</div>
				{domains && (
					<>
						<h3 className="pt-[26px] pb-2 t-section-title">
							<Trans>Your domain</Trans>
						</h3>
						<CustomDomainField suggest={flags?.olacvSuggestion ?? false} />
					</>
				)}
			</section>
		</ShareSubPage>
	);
}

type ShareSettingProps = { setting: ShareSetting };

type PrimaryRowProps = ShareSettingProps & {
	/** The account's other primary resume, when another one holds the role. */
	current: { name: string; isPublic: boolean } | undefined;
	/** Whether the resume list that finds the other primary has loaded. */
	listState: "pending" | "error" | "ready";
	/** Whether this server offers custom domains: without them, the copy names only the short link. */
	domains: boolean;
};

/**
 * The primary resume opens at the account's short link and custom domain. Only a published resume can be primary;
 * publishing the account's first web page makes it primary.
 */
function PrimaryRow({ setting: { update, isPending }, current, listState, domains }: PrimaryRowProps) {
	const resume = useCurrentResume();
	const confirm = useConfirm();
	const isPublic = resume.isPublic ?? false;

	const setPrimary = async (checked: boolean) => {
		if (checked && current) {
			const confirmed = await confirm(t`Make this your primary resume?`, {
				description: t`“${current.name}” stops being your primary resume.`,
				confirmText: t`Make primary`,
				variant: "secondary",
			});
			if (!confirmed) return;
		}
		await update({ isPrimary: checked });
	};

	return (
		<SettingRow
			checked={resume.isPrimary ?? false}
			disabled={isPending || resume.isLocked || (!isPublic && !resume.isPrimary)}
			onCheckedChange={(checked) => void setPrimary(checked)}
			label={t`Primary resume`}
			description={
				resume.isPrimary
					? isPublic
						? domains
							? t`Your short link and custom domain open this resume.`
							: t`Your short link opens this resume.`
						: domains
							? t`Your short link and custom domain say this resume isn't shared until you publish it again.`
							: t`Your short link says this resume isn't shared until you publish it again.`
					: !isPublic
						? `${domains ? t`Publish this resume to open it at your short link and custom domain.` : t`Publish this resume to open it at your short link.`} ${t`If another resume holds Primary, turn it on for this one instead.`}`
						: listState === "pending"
							? t`Checking which resume opens your short link…`
							: listState === "error"
								? t`Couldn't check which resume opens your short link. Reload the page and try again.`
								: current
									? current.isPublic
										? domains
											? t`Your short link and custom domain open “${current.name}”.`
											: t`Your short link opens “${current.name}”.`
										: domains
											? t`Your short link and custom domain point to “${current.name}”, which isn't published.`
											: t`Your short link points to “${current.name}”, which isn't published.`
									: isPublic
										? domains
											? t`Turn this on to open this resume at your short link and custom domain.`
											: t`Turn this on to open this resume at your short link.`
										: `${domains ? t`Publish this resume to open it at your short link and custom domain.` : t`Publish this resume to open it at your short link.`} ${t`If another resume holds Primary, turn it on for this one instead.`}`
			}
		/>
	);
}

/** The web page uses the resume's template and Design; the footer credit is its one setting of its own. */
function CreditRow() {
	const data = useResumeData();
	const updateResumeData = useUpdateResumeData();
	const locked = useIsResumeLocked();

	return (
		<SettingRow
			checked={data?.metadata.web?.showCredit !== false}
			disabled={locked}
			onCheckedChange={(checked) =>
				updateResumeData((draft) => {
					draft.metadata.web = { ...draft.metadata.web, showCredit: checked };
				})
			}
			label={t`Show “Made with Reactive Resume”`}
		/>
	);
}

/** B27: who can find the page, open it, reach the author and take a copy, and the footer credit. */
function PrivacySettings({ setting: { update, isPending } }: ShareSettingProps) {
	const resume = useCurrentResume();
	const isPublic = resume.isPublic ?? false;
	const disabled = isPending || resume.isLocked;
	const searchBlocked = !isPublic || (resume.hasPassword ?? false);

	return (
		<section aria-labelledby="share-privacy-title" className="mt-2 flex flex-col">
			<h3 id="share-privacy-title" className="sr-only">
				<Trans>Privacy</Trans>
			</h3>
			<div className="flex flex-col">
				<SettingRow
					checked={resume.hideContactDetails ?? false}
					disabled={disabled}
					onCheckedChange={(checked) => void update({ hideContactDetails: checked })}
					label={t`Hide contact details`}
					previewContactDetails
					description={t`Your email, phone, location and extra header fields, and references' phone numbers, are left out of the web page, its PDF and search results. Your website stays.`}
				/>
				<SettingRow
					checked={(resume.showInSearchEngines ?? false) && !searchBlocked}
					disabled={disabled || searchBlocked}
					onCheckedChange={(checked) => void update({ showInSearchEngines: checked })}
					label={t`Show in search engines`}
					description={
						searchBlocked
							? resume.hasPassword
								? t`Not available while the resume needs a password.`
								: t`Publish the web page first.`
							: resume.showInSearchEngines
								? t`Search engines such as Google may list your web page. It can take weeks to appear, or to disappear after you turn this off.`
								: t`Off. Let recruiters find you on Google by turning this on.`
					}
				/>
				<PasswordRow />
			</div>
			<SubHeading>
				<Trans>Downloads</Trans>
			</SubHeading>
			<div className="flex flex-col">
				<SettingRow
					checked={resume.showDownloadButtons !== false}
					disabled={disabled}
					onCheckedChange={(checked) => void update({ showDownloadButtons: checked })}
					label={t`Visitors can download the PDF`}
				/>
				<SettingRow
					checked={resume.allowWordDownload === true}
					disabled={disabled}
					onCheckedChange={(checked) => void update({ allowWordDownload: checked })}
					label={t`Visitors can download Word`}
					description={t`Off by default. Shares an editable Word file with the same visible content as your web page. Layout is simplified.`}
				/>
			</div>
			<SubHeading>
				<Trans>Credit</Trans>
			</SubHeading>
			<CreditRow />
		</section>
	);
}

/** Q3a: visitors enter a password before they see the resume. */
function PasswordRow() {
	const resume = useCurrentResume();
	const patchResume = usePatchResume();
	const confirm = useConfirm();
	const [dialogOpen, setDialogOpen] = useState(false);
	// Like the switches: through the autosave owner, so the next autosave builds on the password's revision.
	const setPassword = (password: string) =>
		saveResumeMetadata(resume.id, (expectedUpdatedAt, options) =>
			orpc.resume.setPassword.call({ id: resume.id, password, expectedUpdatedAt }, options),
		);
	const removePassword = () =>
		saveResumeMetadata(resume.id, (expectedUpdatedAt, options) =>
			orpc.resume.removePassword.call({ id: resume.id, expectedUpdatedAt }, options),
		);

	const turnOff = async () => {
		const confirmed = await confirm(t`Remove the password?`, {
			description: t`Anyone with the link will be able to view your resume.`,
			confirmText: t`Remove password`,
			cancelText: t`Keep password`,
			variant: "danger",
		});
		if (!confirmed) return;
		try {
			await removePassword();
			patchResume((draft) => {
				draft.hasPassword = false;
			});
			toast.add({ description: t`Password removed` });
		} catch (error) {
			toastShareError(error);
		}
	};

	return (
		<>
			<SettingRow
				checked={resume.hasPassword ?? false}
				disabled={resume.isLocked}
				onCheckedChange={(checked) => (checked ? setDialogOpen(true) : void turnOff())}
				label={t`Require a password`}
				description={t`Visitors enter it before they see the resume. Share it only with people you trust.`}
			>
				{resume.hasPassword && !resume.isLocked && (
					<Button variant="secondary" size="sm" className="mt-2 w-fit" onClick={() => setDialogOpen(true)}>
						<Trans>Change</Trans>
					</Button>
				)}
			</SettingRow>
			{dialogOpen && (
				<ResumePasswordDialog
					onClose={() => setDialogOpen(false)}
					onSubmit={async (password) => {
						await setPassword(password);
						patchResume((draft) => {
							draft.hasPassword = true;
						});
						toast.add({ description: t`Password set` });
					}}
				/>
			)}
		</>
	);
}

/** The QR code is for print (a card, a paper resume): it saves as SVG for print, or PNG for anything else. */
function QrCodeButton({ url }: { url: string }) {
	const svgRef = useRef<SVGSVGElement>(null);
	const svgBlob = () => {
		const svg = svgRef.current;
		return svg ? new Blob([new XMLSerializer().serializeToString(svg)], { type: "image/svg+xml" }) : null;
	};
	const saveSvg = () => {
		const blob = svgBlob();
		if (blob) downloadWithAnchor(blob, "resume-qr-code.svg");
	};
	const failed = () => toast.add({ type: "error", description: t`Couldn't save the QR code as PNG. Try SVG instead.` });
	const savePng = () => {
		const blob = svgBlob();
		if (!blob) return failed();
		const source = URL.createObjectURL(blob);
		const image = new Image();
		image.onload = () => {
			// Four times the on-screen size, so it stays sharp when printed.
			const canvas = document.createElement("canvas");
			canvas.width = canvas.height = 704;
			const context = canvas.getContext("2d");
			context?.drawImage(image, 0, 0, canvas.width, canvas.height);
			URL.revokeObjectURL(source);
			canvas.toBlob((png) => (png ? downloadWithAnchor(png, "resume-qr-code.png") : failed()), "image/png");
		};
		image.onerror = () => {
			URL.revokeObjectURL(source);
			failed();
		};
		image.src = source;
	};

	return (
		<Popover>
			<PopoverTrigger
				render={
					<button type="button" className={textLinkClassName}>
						<Icon name="qr-code" />
						<Trans>QR code</Trans>
					</button>
				}
			/>
			<PopoverContent className="grid w-auto gap-2 p-4 pb-2">
				<QRCodeSVG ref={svgRef} value={url} size={176} marginSize={2} title={t`QR code for ${url}`} />
				<div className="-mx-2 flex">
					<Button variant="ghost" size="sm" onClick={savePng}>
						<Trans>Save PNG</Trans>
					</Button>
					<Button variant="ghost" size="sm" onClick={saveSvg}>
						<Trans>Save SVG</Trans>
					</Button>
				</div>
			</PopoverContent>
		</Popover>
	);
}

/** Only the owner sees these; downloads count successful clicks, including repeats. Dim while the link is off. */
function ViewsAndDownloads({ isPublic }: { isPublic: boolean }) {
	const resume = useCurrentResume();
	const { i18n } = useLingui();
	const { data: statistics } = useQuery(orpc.resume.statistics.getById.queryOptions({ input: { id: resume.id } }));
	const { data: daily } = useQuery({
		...orpc.resume.statistics.getDailyById.queryOptions({ input: { id: resume.id, days: 30 } }),
		enabled: isPublic,
	});
	const summary = summarizeViews(daily ?? []);
	const firstDay = daily?.[0]?.date;
	const lastView = statistics?.lastViewedAt ? formatTimeSince(statistics.lastViewedAt, i18n.locale) : undefined;
	const firstLabel = firstDay
		? new Date(`${firstDay}T00:00:00`).toLocaleDateString(i18n.locale, { month: "short", day: "numeric" })
		: "";

	return (
		<section aria-labelledby="share-stats-title" className={cn(!isPublic && "opacity-50")}>
			<SectionHeading id="share-stats-title" note={<Trans>only you see these</Trans>}>
				<Trans>Visitors</Trans>
			</SectionHeading>

			{isPublic ? (
				<>
					<dl className="flex flex-wrap items-baseline gap-x-2.5">
						<Stat value={summary.views} label={t`views in the last 30 days`} />
						<Stat value={summary.downloads} label={t`downloads`} className="ms-3.5" />
					</dl>
					<div
						role="img"
						aria-label={[
							t`Views per day, ${firstLabel} to today. The busiest day had ${i18n.number(summary.peak)}.`,
							lastView ? t`Last counted view ${lastView} ago. Each visitor counts once an hour.` : "",
						]
							.filter(Boolean)
							.join(" ")}
						title={lastView ? t`Last counted view ${lastView} ago. Each visitor counts once an hour.` : undefined}
						className="mt-3 flex h-11 items-end gap-[3px]"
					>
						{summary.bars.map((bar) =>
							bar.views > 0 ? (
								<i
									key={bar.date}
									className="flex-1 rounded-t-[1px] bg-ink-3"
									style={{ height: `${Math.round(bar.height * 100)}%` }}
								/>
							) : (
								<i key={bar.date} className="h-0.5 flex-1 rounded-[1px] bg-line-2" />
							),
						)}
					</div>
					<div className="flex flex-wrap justify-between gap-x-2 pt-1.5 t-mono text-ink-3">
						<span>{firstLabel}</span>
						{lastView && (
							<span className="t-caption font-sans">
								<Trans>Last counted view {lastView} ago</Trans>
							</span>
						)}
						<span>
							<Trans>Today</Trans>
						</span>
					</div>
				</>
			) : (
				<p className="t-small text-ink-2">
					<Trans>
						Publish the web page to count views and downloads. Counts are anonymous, and search engines aren't counted.
					</Trans>
				</p>
			)}
		</section>
	);
}

type StatProps = { value: number; label: string; className?: string };

function Stat({ value, label, className }: StatProps) {
	const { i18n } = useLingui();
	return (
		<div className={cn("flex flex-row-reverse items-baseline gap-2.5", className)}>
			<dt className="t-small text-ink-3">{label}</dt>
			{/* Lining figures: in the display face an old-style "1" reads as "l". */}
			<dd className="t-big-number tabular-nums [font-variant-numeric:lining-nums_tabular-nums]">
				{i18n.number(value)}
			</dd>
		</div>
	);
}

/** One row that opens the feedback links (P4), with how many are active. */
function FeedbackRow({ onOpen }: { onOpen: () => void }) {
	const resume = useCurrentResume();
	const { data: links } = useQuery(orpc.feedback.list.queryOptions({ input: { resumeId: resume.id } }));
	const active = links?.filter((link) => link.status === "active").length ?? 0;

	return (
		<List cap className="mt-3.5">
			<ListRow
				render={<button type="button" onClick={onOpen} />}
				title={<Trans>Feedback links</Trans>}
				value={active > 0 ? <Trans>{active} active</Trans> : undefined}
				caret
			/>
		</List>
	);
}

function FeedbackPage({ onBack }: { onBack: () => void }) {
	const resume = useCurrentResume();
	return (
		<ShareSubPage
			title={<Trans>Feedback links</Trans>}
			description={
				<Trans>
					Send a coach or friend a private link to this version. They can comment, but can't change it or see anything
					else.
				</Trans>
			}
			onBack={onBack}
		>
			<div className="mt-4">
				<FeedbackLinksSection resumeId={resume.id} titled={false} />
			</div>
		</ShareSubPage>
	);
}
