import { t } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import { Trans } from "@lingui/react/macro";
import { ORPCError } from "@orpc/client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouteContext } from "@tanstack/react-router";
import { QRCodeSVG } from "qrcode.react";
import { useEffect, useId, useRef, useState } from "react";
import { useDebounceValue } from "usehooks-ts";
import { Button, buttonVariants } from "@reactive-resume/ui/components/button";
import { Icon } from "@reactive-resume/ui/components/icon";
import { Input } from "@reactive-resume/ui/components/input";
import { Popover, PopoverContent, PopoverTrigger } from "@reactive-resume/ui/components/popover";
import { Separator } from "@reactive-resume/ui/components/separator";
import { SwitchRow } from "@reactive-resume/ui/components/switch";
import { toast } from "@reactive-resume/ui/components/toast";
import { cn } from "@reactive-resume/utils/style";
import { CopyLinkButton } from "./copy-link-button";
import { formatTimeSince, summarizeViews } from "./format";
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
import { ENTER_CLASS } from "@/libs/motion";
import { orpc } from "@/libs/orpc/client";

const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

const errorMessage = (error: unknown) =>
	error instanceof ORPCError ? error.message : t`Couldn't update sharing. Try again.`;

/**
 * Share: the web page and everything about who sees what. Publishing, the address, the primary resume, the web
 * page's footer, privacy and the numbers. Private is the default; turning the link off keeps the address.
 */
export function SharePanel() {
	const resume = useCurrentResume();
	const { data: session } = authClient.useSession();
	const { update, isPending } = useShareSetting();
	const isPublic = resume.isPublic ?? false;
	const url = `${window.location.origin}/${session?.user.username ?? ""}/${resume.slug}`;

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

			<AddressField url={url} username={session?.user.username ?? ""} />

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

			<AddressesSection username={session?.user.username ?? ""} />

			<Separator />
			<WebPageSettings />

			<Separator />
			<PrivacySettings />

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
	showContactButton?: boolean;
	isPrimary?: boolean;
};

/** Saves Share switches that live beside the resume, not in it, and mirrors the result into the open draft. */
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
				draft.showContactButton = updated.showContactButton;
				draft.isPrimary = updated.isPrimary;
			});
			// Another resume may have handed over its primary role.
			if (settings.isPrimary) void queryClient.invalidateQueries({ queryKey: orpc.resume.list.key() });
			return true;
		} catch (error) {
			toast.add({ type: "error", description: errorMessage(error) });
			return false;
		}
	};

	return { update, isPending };
}

/** A DNS label: what a username must look like to be a subdomain or a domain of its own. */
const DNS_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/** The short link and custom domain, both opening the primary resume. Shown when the server offers either. */
function AddressesSection({ username }: { username: string }) {
	const { flags } = useRouteContext({ strict: false });
	const shortLinkUrl = flags?.shortLinkUrl;
	if (!shortLinkUrl && !flags?.customDomains) return null;
	const shortLink = shortLinkUrl ? `${shortLinkUrl}/${username}` : undefined;

	return (
		<>
			<Separator />
			<section aria-labelledby="share-addresses-title" className="grid gap-3">
				<h3 id="share-addresses-title" className="text-sm font-semibold">
					<Trans>Short link and domain</Trans>
				</h3>
				<PrimaryRow />
				{shortLink && (
					<div className="flex items-center gap-1.5">
						<span className="min-w-0 flex-1 truncate font-mono text-[13px] font-medium text-ink-2" dir="ltr">
							{shortLink.replace(/^https?:\/\//, "")}
						</span>
						<CopyLinkButton
							url={shortLink}
							label={t`Copy`}
							className="h-8 gap-1.5"
							onCopied={() => toast.add({ description: t`Link copied` })}
						/>
					</div>
				)}
				{flags?.customDomains && (
					<CustomDomainField
						suggestion={flags.olacvSuggestion && DNS_LABEL.test(username) ? `${username}.cv` : undefined}
					/>
				)}
			</section>
		</>
	);
}

/** Connects the account's own domain: the DNS records to add, a check, and the result. */
function CustomDomainField({ suggestion }: { suggestion: string | undefined }) {
	const id = useId();
	const queryClient = useQueryClient();
	const { data: domain, isPending: loading } = useQuery(orpc.customDomain.get.queryOptions());
	const [hostname, setHostname] = useState("");
	const refresh = (next: unknown) => queryClient.setQueryData(orpc.customDomain.get.queryKey(), next as typeof domain);
	const set = useMutation({ ...orpc.customDomain.set.mutationOptions(), onSuccess: refresh });
	const verify = useMutation({ ...orpc.customDomain.verify.mutationOptions(), onSuccess: refresh });
	const remove = useMutation({ ...orpc.customDomain.remove.mutationOptions(), onSuccess: () => refresh(null) });
	const onError = (error: unknown) => toast.add({ type: "error", description: errorMessage(error) });

	if (loading) return null;

	if (!domain)
		return (
			<form
				className="grid gap-1.5"
				onSubmit={(event) => {
					event.preventDefault();
					set.mutate({ hostname }, { onError });
				}}
			>
				<label htmlFor={id} className="text-xs font-medium text-ink-2">
					<Trans>Your domain</Trans>
				</label>
				<div className="flex gap-1.5">
					<Input
						id={id}
						value={hostname}
						placeholder="resume.example.com"
						spellCheck={false}
						autoCapitalize="none"
						onChange={(event) => setHostname(event.target.value)}
						className="h-[38px] font-mono text-[13px]"
					/>
					<Button
						type="submit"
						variant="secondary"
						className="h-[38px]"
						loading={set.isPending}
						disabled={!hostname.trim()}
					>
						<Trans>Connect</Trans>
					</Button>
				</div>
				{suggestion && (
					<a
						href={`https://ola.cv/?domain=${encodeURIComponent(suggestion)}`}
						target="_blank"
						rel="noopener sponsored"
						className="text-xs text-ink-2 underline-offset-2 hover:text-ink hover:underline"
					>
						<Trans>{suggestion} may be available. Get yours here →</Trans>
					</a>
				)}
			</form>
		);

	return (
		<div className="grid gap-2.5 rounded-xl border border-line p-3.5">
			<div className="flex items-center gap-2">
				<Icon
					name={domain.verified ? "check-circle" : "warning-circle"}
					size={18}
					className={domain.verified ? "text-accent-text" : "text-warn-text"}
				/>
				<span className="min-w-0 flex-1 truncate font-mono text-[13px] font-medium" dir="ltr">
					{domain.hostname}
				</span>
				<Button
					variant="ghost"
					size="sm"
					loading={remove.isPending}
					onClick={() => remove.mutate(undefined, { onError })}
				>
					<Trans>Remove</Trans>
				</Button>
			</div>
			{domain.verified ? (
				<p className="text-xs leading-4 text-ink-3">
					<Trans>Connected. Your domain opens your primary resume.</Trans>
				</p>
			) : (
				<>
					<p className="text-xs leading-4 text-ink-2">
						<Trans>
							Add these records where you manage the domain, then check. Changes can take a few hours to reach everyone.
						</Trans>
					</p>
					<dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1.5 font-mono text-[12px]" dir="ltr">
						<dt className="text-ink-3">CNAME</dt>
						<dd className="break-all">
							{domain.hostname} → {domain.target}
						</dd>
						<dt className="text-ink-3">TXT</dt>
						<dd className="break-all">
							{domain.txtName} = {domain.txtValue}
						</dd>
					</dl>
					<p className="text-xs leading-4 text-ink-3">
						<Trans>
							For a root domain such as example.com, use A and AAAA records with {domain.target}'s addresses instead of
							the CNAME.
						</Trans>
					</p>
					<Button
						variant="secondary"
						className="w-fit"
						loading={verify.isPending}
						onClick={() =>
							verify.mutate(undefined, {
								onError,
								onSuccess: (next) =>
									toast.add(
										next.verified
											? { description: t`Domain connected` }
											: { type: "error", description: t`The records aren't visible yet. Check again later.` },
									),
							})
						}
					>
						<Trans>Check DNS</Trans>
					</Button>
				</>
			)}
		</div>
	);
}

/** The primary resume opens at the account's short link and custom domain. Only a published resume can be primary. */
function PrimaryRow() {
	const resume = useCurrentResume();
	const confirm = useConfirm();
	const { update, isPending } = useShareSetting();
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
function PrivacySettings() {
	const resume = useCurrentResume();
	const { update, isPending } = useShareSetting();
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
			{resume.hideContactDetails && (
				<SwitchRow
					checked={resume.showContactButton !== false}
					disabled={disabled}
					onCheckedChange={(checked) => void update({ showContactButton: checked })}
					label={t`Let visitors ask to see them`}
					description={t`A “Show contact details” button reveals them to people, not to search engines.`}
					className={cn(ENTER_CLASS, "items-start py-0 ps-4")}
				/>
			)}
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

type AddressFieldProps = { url: string; username: string };

/** The address as typed, its live availability check (300 ms), and the save once a new one checks out. */
function useSlugAvailability() {
	const resume = useCurrentResume();
	const patchResume = usePatchResume();
	const [slug, setSlug] = useState(resume.slug);
	const [debouncedSlug] = useDebounceValue(slug, 300);
	const { mutateAsync: updateResume } = useMutation(orpc.resume.update.mutationOptions());

	const changed = slug !== resume.slug;
	const wellFormed = SLUG_PATTERN.test(slug);
	const check = useQuery({
		...orpc.resume.checkSlug.queryOptions({ input: { resumeId: resume.id, slug: debouncedSlug } }),
		enabled: (resume.isPublic ?? false) && changed && wellFormed && debouncedSlug === slug,
	});
	const result = debouncedSlug === slug ? check.data : undefined;

	// Save as soon as a new address checks out; until then the current one keeps working.
	const saving = useRef<string | null>(null);
	useEffect(() => {
		if (result?.status !== "available" || saving.current === slug) return;
		saving.current = slug;
		updateResume({ id: resume.id, slug })
			.then((updated) =>
				patchResume((draft) => {
					draft.slug = updated.slug;
				}),
			)
			.catch((error: unknown) => toast.add({ type: "error", description: errorMessage(error) }))
			.finally(() => {
				saving.current = null;
			});
	}, [result?.status, slug, resume.id, updateResume, patchResume]);

	// A save here, another tab or a restore can change the address; the field follows it unless the user is typing.
	const [savedSlug, setSavedSlug] = useState(resume.slug);
	if (resume.slug !== savedSlug) {
		setSavedSlug(resume.slug);
		if (slug === savedSlug) setSlug(resume.slug);
	}

	return { slug, setSlug, changed, wellFormed, result };
}

type AddressMessageArgs = {
	isPublic: boolean;
	slug: string;
	wellFormed: boolean;
	changed: boolean;
	status: string | undefined;
	url: string;
	username: string;
};

/** The hint under the field; null when the taken-address block renders its own text. */
function addressMessage({ isPublic, slug, wellFormed, changed, status, url, username }: AddressMessageArgs) {
	if (!isPublic) return t`Turn on the link to choose an address.`;
	if (!slug) return t`Add an address.`;
	if (!wellFormed) return t`Use lowercase letters, numbers and single dashes.`;
	if (!changed) return t`Live at ${url.replace(/^https?:\/\//, "")}`;
	if (status === "taken") return null;
	if (status === "available")
		return t`Saving ${window.location.host}/${username}/${slug}… Copy is available after saving.`;
	return t`Checking… Copy is available after saving.`;
}

/** The address, checked as you type. The old one stays live until the new one is valid and saved. */
function AddressField({ url, username }: AddressFieldProps) {
	const resume = useCurrentResume();
	const id = useId();
	const isPublic = resume.isPublic ?? false;
	const { slug, setSlug, changed, wellFormed, result } = useSlugAvailability();

	const invalid = isPublic && (!slug || !wellFormed || result?.status === "taken");
	const message = addressMessage({ isPublic, slug, wellFormed, changed, status: result?.status, url, username });

	const canShare = typeof navigator.share === "function";

	return (
		<div className={cn("grid gap-1.5 transition-opacity duration-standard", !isPublic && "opacity-45")}>
			<label htmlFor={id} className="text-xs font-medium text-ink-2">
				<Trans>Address</Trans>
			</label>
			<div className="flex gap-1.5">
				<div
					className={cn(
						"flex h-[38px] min-w-0 flex-1 items-center overflow-hidden rounded-lg border bg-raised transition-colors duration-quick focus-within:ring-3",
						invalid
							? "border-danger focus-within:border-danger focus-within:ring-danger/15"
							: "border-line-2 focus-within:border-accent focus-within:ring-accent-soft",
					)}
				>
					{/* A long host or username truncates, so the part being edited stays visible. */}
					<span className="max-w-[55%] truncate ps-2.5 font-mono text-[13px] font-medium text-ink-3" dir="ltr">
						{window.location.host}/{username}/
					</span>
					<input
						id={id}
						value={slug}
						disabled={!isPublic || resume.isLocked}
						spellCheck={false}
						aria-invalid={invalid}
						aria-describedby={`${id}-message`}
						onChange={(event) => setSlug(event.target.value.toLowerCase().replace(/\s+/g, "-"))}
						className="h-full min-w-0 flex-1 bg-transparent pe-1.5 font-mono text-[13px] font-medium text-ink outline-none"
					/>
					{isPublic && slug && (
						<Icon
							name={invalid ? "warning-circle" : "check-circle"}
							size={18}
							className={cn("me-2.5", invalid ? "text-danger-text" : "text-accent-text")}
						/>
					)}
				</div>
				<CopyLinkButton
					url={url}
					label={t`Copy`}
					className="h-[38px] gap-1.5"
					disabled={!isPublic || changed}
					onCopied={() => toast.add({ description: t`Link copied` })}
				/>
			</div>
			<p
				id={`${id}-message`}
				role="status"
				className={cn("text-xs leading-4 break-all", invalid ? "text-danger-text" : "text-ink-3")}
			>
				{result?.status === "taken" ? (
					<>
						{result.takenBy ? (
							<Trans>You already use this for “{result.takenBy}”.</Trans>
						) : (
							<Trans>Another of your resumes uses this address.</Trans>
						)}{" "}
						{result.suggestion && (
							<button
								type="button"
								className="font-medium text-ink underline underline-offset-2"
								onClick={() => setSlug(result.suggestion ?? slug)}
							>
								<Trans>Try {result.suggestion}</Trans>
							</button>
						)}
					</>
				) : (
					message
				)}
			</p>
			{isPublic && canShare && (
				<Button
					variant="secondary"
					className="w-fit gap-1.5 pointer-fine:hidden"
					onClick={() => void navigator.share({ title: resume.name, url }).catch(() => undefined)}
				>
					<Icon name="export" size={18} />
					<Trans>Share via…</Trans>
				</Button>
			)}
		</div>
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
			toast.add({ type: "error", description: errorMessage(error) });
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
						{resume.hideContactDetails && <Stat value={summary.contactReveals} label={t`asked for contact details`} />}
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
