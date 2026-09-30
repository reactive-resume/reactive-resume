import { t } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import { Trans } from "@lingui/react/macro";
import { ORPCError } from "@orpc/client";
import { useMutation, useQuery } from "@tanstack/react-query";
import { QRCodeSVG } from "qrcode.react";
import { useEffect, useId, useRef, useState } from "react";
import { useDebounceValue } from "usehooks-ts";
import { Button, buttonVariants } from "@reactive-resume/ui/components/button";
import { Icon } from "@reactive-resume/ui/components/icon";
import { Popover, PopoverContent, PopoverTrigger } from "@reactive-resume/ui/components/popover";
import { Separator } from "@reactive-resume/ui/components/separator";
import { SwitchRow } from "@reactive-resume/ui/components/switch";
import { toast } from "@reactive-resume/ui/components/toast";
import { cn } from "@reactive-resume/utils/style";
import { CopyLinkButton } from "./copy-link-button";
import { formatTimeSince, summarizeViews } from "./format";
import { useCurrentResume, usePatchResume } from "@/features/resume/builder/draft";
import { ResumePasswordDialog } from "@/features/resume/builder/password-dialog";
import { useConfirm } from "@/hooks/use-confirm";
import { authClient } from "@/libs/auth/client";
import { ENTER_CLASS } from "@/libs/motion";
import { orpc } from "@/libs/orpc/client";

const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

const errorMessage = (error: unknown) =>
	error instanceof ORPCError ? error.message : t`Something went wrong. Please try again.`;

/**
 * Link: the public switch, the address with its live check, copy, downloads for visitors, open, QR code and
 * the password, then views and downloads. Private is the default; turning the link off keeps the address.
 */
export function LinkTab() {
	const resume = useCurrentResume();
	const patchResume = usePatchResume();
	const { data: session } = authClient.useSession();
	const { mutateAsync: updateResume, isPending } = useMutation(orpc.resume.update.mutationOptions());
	const isPublic = resume.isPublic ?? false;
	const url = `${window.location.origin}/${session?.user.username ?? ""}/${resume.slug}`;

	const setPublic = async (checked: boolean) => {
		const description = checked ? t`Link is live` : t`Link turned off. The address is kept`;
		try {
			const updated = await updateResume({ id: resume.id, isPublic: checked });
			patchResume((draft) => {
				draft.isPublic = updated.isPublic;
			});
			toast.add({ description });
		} catch (error) {
			toast.add({ type: "error", description: errorMessage(error) });
		}
	};

	const setVisitorDownloads = async (checked: boolean) => {
		try {
			const updated = await updateResume({ id: resume.id, showDownloadButtons: checked });
			patchResume((draft) => {
				draft.showDownloadButtons = updated.showDownloadButtons;
			});
		} catch (error) {
			toast.add({ type: "error", description: errorMessage(error) });
		}
	};

	return (
		<div className="grid gap-[18px]">
			<SwitchRow
				checked={isPublic}
				disabled={isPending || resume.isLocked}
				onCheckedChange={(checked) => void setPublic(checked)}
				label={<span className="font-semibold">{t`Public link`}</span>}
				description={
					isPublic
						? t`On. Anyone with the link can view. It isn't listed or indexed by search engines.`
						: t`Off. Only you can see this resume.`
				}
				className="items-start rounded-xl border border-line p-3.5 transition-colors duration-standard data-checked:border-accent data-checked:bg-accent-soft"
			/>

			<AddressField url={url} username={session?.user.username ?? ""} />

			{isPublic && (
				<div className={cn(ENTER_CLASS, "grid gap-3")}>
					<SwitchRow
						checked={resume.showDownloadButtons !== false}
						disabled={isPending || resume.isLocked}
						onCheckedChange={(checked) => void setVisitorDownloads(checked)}
						label={t`Visitors can download the PDF`}
						className="py-0"
					/>
					<PasswordRow />
					<div className="flex flex-wrap gap-2">
						<a
							href={url}
							target="_blank"
							rel="noopener"
							className={buttonVariants({ variant: "ghost", size: "sm", className: "gap-1.5" })}
						>
							<Icon name="open_in_new" size={18} />
							<Trans>Open public page</Trans>
						</a>
						<QrCodeButton url={url} />
					</div>
				</div>
			)}

			<Separator />
			<ViewsAndDownloads isPublic={isPublic} />
		</div>
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
							name={invalid ? "error" : "check_circle"}
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
					<Icon name="ios_share" size={18} />
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
			confirmText: t`Remove`,
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
						<Icon name="qr_code_2" size={18} />
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
					<Trans>Views and downloads</Trans>
				</h3>
				<span className="text-xs text-ink-3">
					<Trans>Only you see these</Trans>
				</span>
			</div>

			{isPublic ? (
				<>
					<dl className="grid grid-cols-3 gap-2.5">
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
								className="flex-1 rounded-t-[2px] bg-line-2"
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
					<Trans>Turn on the public link to count views and downloads. Counts are anonymous.</Trans>
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
