import { t } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import { Trans } from "@lingui/react/macro";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouteContext } from "@tanstack/react-router";
import { QRCodeSVG } from "qrcode.react";
import { useState } from "react";
import { formatTimeSince, publicResumeUrl, summarizeViews } from "@reactive-resume/resume/sharing";
import { Button, buttonVariants } from "@reactive-resume/ui/components/button";
import { Icon } from "@reactive-resume/ui/components/icon";
import { Popover, PopoverContent, PopoverTrigger } from "@reactive-resume/ui/components/popover";
import { Separator } from "@reactive-resume/ui/components/separator";
import { SwitchRow } from "@reactive-resume/ui/components/switch";
import { toast } from "@reactive-resume/ui/components/toast";
import { cn } from "@reactive-resume/utils/style";
import { AddressField } from "./address-field";
import { CopyLinkButton } from "./copy-link-button";
import { CustomDomainField } from "./custom-domain-field";
import { useShareOrigin } from "./use-share-origin";
import { templates } from "@/dialogs/resume/template/data";
import {
	useCurrentResume,
	useIsResumeLocked,
	usePatchResume,
	useResumeData,
	useUpdateResumeData,
} from "@/features/resume/builder/draft";
import { ResumePasswordDialog } from "@/features/resume/builder/password-dialog";
import { useConfirm } from "@/hooks/use-confirm";
import { authClient } from "@/libs/auth/client";
import { toastError } from "@/libs/error-message";
import { ENTER_CLASS } from "@/libs/motion";
import { orpc } from "@/libs/orpc/client";

const toastShareError = (error: unknown) =>
	toastError(error, t`Couldn't update sharing. Try again.`, { allowServerMessage: true });

/**
 * Share: the web page and everything about who sees what. Publishing, the address, the primary resume, the web
 * page's footer, privacy and the numbers. Private is the default; turning the link off keeps the address.
 */
export function SharePanel() {
	const resume = useCurrentResume();
	const { data: session } = authClient.useSession();
	const setting = useShareSetting();
	const { update, isPending } = setting;
	const isPublic = resume.isPublic ?? false;
	const origin = useShareOrigin();
	const username = session?.user.username ?? "";
	const url = publicResumeUrl(origin, { username, slug: resume.slug });

	const setPublic = async (checked: boolean) => {
		const done = await update({ isPublic: checked });
		if (done) toast.add({ description: checked ? t`Your web page is live` : t`Link turned off. The address is kept` });
	};

	return (
		<div className="grid gap-[18px] p-4">
			{isPublic ? (
				<SwitchRow
					checked
					disabled={isPending || resume.isLocked}
					onCheckedChange={(checked) => void setPublic(checked)}
					label={<span className="font-semibold">{t`Public link`}</span>}
					description={t`On. Anyone with the link can see your web page.`}
					className="items-start rounded-xl border border-line p-3.5 transition-colors duration-standard data-checked:border-accent data-checked:bg-accent-soft"
				/>
			) : (
				<div className="grid gap-3 rounded-xl border border-line p-3.5">
					<div className="grid gap-1">
						<h3 className="text-sm font-semibold">
							<Trans>Your resume as a web page</Trans>
						</h3>
						<p className="text-[13px] leading-[19px] text-ink-2">
							<Trans>Publish it to share a link that opens on any screen. Only you can see it until then.</Trans>
						</p>
					</div>
					<Button className="w-fit" disabled={isPending || resume.isLocked} onClick={() => void setPublic(true)}>
						<Icon name="globe-hemisphere-west" size={18} />
						<Trans>Publish</Trans>
					</Button>
				</div>
			)}

			<AddressField url={url} username={username} update={update} />

			{isPublic && (
				<div className={cn(ENTER_CLASS, "flex flex-wrap gap-2")}>
					<a
						href={url}
						target="_blank"
						rel="noopener"
						className={buttonVariants({ variant: "ghost", size: "sm", className: "gap-1.5" })}
					>
						<Icon name="arrow-square-out" size={18} />
						<Trans>Open web page</Trans>
					</a>
					<QrCodeButton url={url} />
				</div>
			)}

			<AddressesSection origin={origin} username={username} setting={setting} />

			<Separator />
			<WebPageSettings />

			<Separator />
			<PrivacySettings setting={setting} />

			<Separator />
			<ViewsAndDownloads isPublic={isPublic} />
		</div>
	);
}

type ShareSettings = {
	isPublic?: boolean;
	showDownloadButtons?: boolean;
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
	const patchResume = usePatchResume();
	const queryClient = useQueryClient();
	const { mutateAsync: updateResume, isPending } = useMutation(orpc.resume.update.mutationOptions());

	const update = async (settings: ShareSettings) => {
		try {
			const updated = await updateResume({ id: resume.id, ...settings });
			patchResume((draft) => {
				draft.isPublic = updated.isPublic;
				draft.showDownloadButtons = updated.showDownloadButtons;
				draft.showInSearchEngines = updated.showInSearchEngines;
				draft.hideContactDetails = updated.hideContactDetails;
				draft.isPrimary = updated.isPrimary;
				draft.slug = updated.slug;
			});
			// Another resume may have handed over its primary role.
			if (settings.isPrimary) void queryClient.invalidateQueries({ queryKey: orpc.resume.list.key() });
			return true;
		} catch (error) {
			toastShareError(error);
			return false;
		}
	};

	return { update, isPending };
}

type AddressesSectionProps = { origin: string; username: string; setting: ShareSetting };

/** The short link (`/<username>`) and custom domain, both opening the primary resume. */
function AddressesSection({ origin, username, setting }: AddressesSectionProps) {
	const resume = useCurrentResume();
	const { flags } = useRouteContext({ strict: false });
	const shortLink = publicResumeUrl(origin, { username, slug: resume.slug, isPrimary: true });

	return (
		<>
			<Separator />
			<section aria-labelledby="share-addresses-title" className="grid gap-3">
				<h3 id="share-addresses-title" className="text-sm font-semibold">
					<Trans>Short link and domain</Trans>
				</h3>
				<PrimaryRow setting={setting} />
				<div className="flex items-center gap-1.5">
					<span className="min-w-0 flex-1 truncate font-mono text-[13px] font-medium text-ink-2" dir="ltr">
						{shortLink.replace(/^https?:\/\//, "")}
					</span>
					<CopyLinkButton url={shortLink} className="h-8 gap-1.5" />
				</div>
				{flags?.customDomains && <CustomDomainField suggest={flags.olacvSuggestion ?? false} />}
			</section>
		</>
	);
}

type ShareSettingProps = { setting: ShareSetting };

/** The primary resume opens at the account's short link and custom domain. Only a published resume can be primary. */
function PrimaryRow({ setting: { update, isPending } }: ShareSettingProps) {
	const resume = useCurrentResume();
	const confirm = useConfirm();
	const { data: resumes } = useQuery(orpc.resume.list.queryOptions());
	const current = resumes?.find((item) => item.isPrimary && item.id !== resume.id);
	const isPublic = resume.isPublic ?? false;

	const setPrimary = async (checked: boolean) => {
		if (checked && current) {
			const confirmed = await confirm(t`Make this your primary resume?`, {
				description: t`“${current.name}” stops being your primary resume.`,
				confirmText: t`Make primary`,
			});
			if (!confirmed) return;
		}
		await update({ isPrimary: checked });
	};

	return (
		<SwitchRow
			checked={resume.isPrimary ?? false}
			disabled={isPending || resume.isLocked || (!isPublic && !resume.isPrimary)}
			onCheckedChange={(checked) => void setPrimary(checked)}
			label={t`Primary resume`}
			description={
				resume.isPrimary
					? isPublic
						? t`Your short link and custom domain open this resume.`
						: t`Your short link and custom domain say this resume isn't shared until you publish it again.`
					: current
						? t`Your short link and custom domain open “${current.name}”.`
						: t`Publish this resume to open it at your short link and custom domain.`
			}
			className="items-start py-0"
		/>
	);
}

/** The web page uses the resume's template and Design; the footer credit is its one setting of its own. */
function WebPageSettings() {
	const data = useResumeData();
	const updateResumeData = useUpdateResumeData();
	const locked = useIsResumeLocked();
	const template = data?.metadata.template ?? "onyx";

	return (
		<section aria-labelledby="share-web-page-title" className="grid gap-3">
			<div className="grid gap-1">
				<h3 id="share-web-page-title" className="text-sm font-semibold">
					<Trans>Web page</Trans>
				</h3>
				<p className="text-xs leading-4 text-ink-3">
					<Trans>
						Uses your {templates[template].name} template and Design, and fits any screen. Change them in Design.
					</Trans>
				</p>
			</div>
			<SwitchRow
				checked={data?.metadata.web?.showCredit !== false}
				disabled={locked}
				onCheckedChange={(checked) =>
					updateResumeData((draft) => {
						draft.metadata.web = { ...draft.metadata.web, showCredit: checked };
					})
				}
				label={t`Show “Made with Reactive Resume”`}
				className="py-0"
			/>
		</section>
	);
}

/** Who can find the page, open it, reach the author and download the PDF. */
function PrivacySettings({ setting: { update, isPending } }: ShareSettingProps) {
	const resume = useCurrentResume();
	const isPublic = resume.isPublic ?? false;
	const disabled = isPending || resume.isLocked;
	const searchBlocked = !isPublic || (resume.hasPassword ?? false);

	return (
		<section aria-labelledby="share-privacy-title" className="grid gap-3">
			<h3 id="share-privacy-title" className="text-sm font-semibold">
				<Trans>Privacy</Trans>
			</h3>
			<PasswordRow />
			<SwitchRow
				checked={resume.hideContactDetails ?? false}
				disabled={disabled}
				onCheckedChange={(checked) => void update({ hideContactDetails: checked })}
				label={t`Hide contact details`}
				description={t`Your email, phone, location and other header details, and references' phone numbers, are left out of the web page, its PDF and search results.`}
				className="items-start py-0"
			/>
			<SwitchRow
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
				className="items-start py-0"
			/>
			<SwitchRow
				checked={resume.showDownloadButtons !== false}
				disabled={disabled}
				onCheckedChange={(checked) => void update({ showDownloadButtons: checked })}
				label={t`Visitors can download the PDF`}
				className="py-0"
			/>
		</section>
	);
}

/** Q3a: visitors enter a password before they see the resume. */
function PasswordRow() {
	const resume = useCurrentResume();
	const patchResume = usePatchResume();
	const confirm = useConfirm();
	const [dialogOpen, setDialogOpen] = useState(false);
	const { mutateAsync: setPassword } = useMutation(orpc.resume.setPassword.mutationOptions());
	const { mutateAsync: removePassword } = useMutation(orpc.resume.removePassword.mutationOptions());

	const turnOff = async () => {
		const confirmed = await confirm(t`Remove the password?`, {
			description: t`Anyone with the link will be able to view your resume.`,
			confirmText: t`Remove password`,
		});
		if (!confirmed) return;
		try {
			await removePassword({ id: resume.id });
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
			<SwitchRow
				checked={resume.hasPassword ?? false}
				disabled={resume.isLocked}
				onCheckedChange={(checked) => (checked ? setDialogOpen(true) : void turnOff())}
				label={t`Require a password`}
				description={
					resume.hasPassword
						? t`Visitors enter it before they see the resume. Share it only with people you trust.`
						: undefined
				}
				className="py-0"
			/>
			{dialogOpen && (
				<ResumePasswordDialog
					onClose={() => setDialogOpen(false)}
					onSubmit={async (password) => {
						await setPassword({ id: resume.id, password });
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

function QrCodeButton({ url }: { url: string }) {
	return (
		<Popover>
			<PopoverTrigger
				render={
					<Button variant="ghost" size="sm" className="gap-1.5">
						<Icon name="qr-code" size={18} />
						<Trans>QR code</Trans>
					</Button>
				}
			/>
			<PopoverContent className="w-auto p-4">
				<QRCodeSVG value={url} size={176} marginSize={2} title={t`QR code for ${url}`} />
			</PopoverContent>
		</Popover>
	);
}

/** Only the owner sees these; downloads count successful clicks, including repeats. */
function ViewsAndDownloads({ isPublic }: { isPublic: boolean }) {
	const resume = useCurrentResume();
	const { i18n } = useLingui();
	const { data: statistics } = useQuery(orpc.resume.statistics.getById.queryOptions({ input: { id: resume.id } }));
	const { data: daily } = useQuery({
		...orpc.resume.statistics.getDailyById.queryOptions({ input: { id: resume.id, days: 30 } }),
		enabled: isPublic,
	});
	const summary = summarizeViews(daily ?? []);
	const lastView = statistics?.lastViewedAt ? formatTimeSince(statistics.lastViewedAt, i18n.locale) : "—";
	const firstDay = daily?.[0]?.date;

	return (
		<section aria-labelledby="share-stats-title" className="grid gap-3">
			<div className="flex items-baseline justify-between">
				<h3 id="share-stats-title" className="text-sm font-semibold">
					<Trans>Visitors</Trans>
				</h3>
				<span className="text-xs text-ink-3">
					<Trans>Only you see these</Trans>
				</span>
			</div>

			{isPublic ? (
				<>
					<dl className="grid grid-cols-2 gap-2.5">
						<Stat value={summary.views} label={t`views · 30 days`} />
						<Stat value={summary.downloads} label={t`downloads`} />
						<Stat value={lastView} label={t`since last view`} />
					</dl>
					<div
						role="img"
						aria-label={t`Daily views over 30 days, peak ${summary.peak}`}
						className="flex h-14 items-end gap-[3px] pt-1"
					>
						{summary.bars.map((bar) => (
							<span
								key={bar.date}
								className="flex-1 rounded-t-sm bg-line-2"
								style={{ height: `${Math.max(6, Math.round(bar.height * 100))}%` }}
							/>
						))}
					</div>
					<div className="flex justify-between font-mono text-[11px] font-medium text-ink-3">
						<span>
							{firstDay
								? new Date(`${firstDay}T00:00:00`).toLocaleDateString(i18n.locale, { month: "short", day: "numeric" })
								: ""}
						</span>
						<span>
							<Trans>Today</Trans>
						</span>
					</div>
				</>
			) : (
				<p className="text-[13px] leading-[19px] text-ink-2">
					<Trans>
						Publish the web page to count views and downloads. Counts are anonymous, and search engines aren't counted.
					</Trans>
				</p>
			)}
			<p className="text-xs text-ink-3">
				<Trans>Download totals can include repeat clicks.</Trans>
			</p>
		</section>
	);
}

function Stat({ value, label }: { value: number | string; label: string }) {
	return (
		<div className="flex flex-col-reverse gap-0.5">
			<dt className="text-xs text-ink-3">{label}</dt>
			<dd className="font-display text-[26px] leading-[30px] font-medium">{value}</dd>
		</div>
	);
}
