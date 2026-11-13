import type { ReactNode } from "react";
import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useEffectEvent, useId, useRef, useState } from "react";
import { useDebounceValue } from "usehooks-ts";
import { isValidSlug, MAX_SLUG_LENGTH, normalizeSlug } from "@reactive-resume/resume/sharing";
import { Button } from "@reactive-resume/ui/components/button";
import { Icon } from "@reactive-resume/ui/components/icon";
import { cn } from "@reactive-resume/utils/style";
import { useCurrentResume } from "@/features/resume/builder/draft";
import { orpc } from "@/libs/orpc/client";

type SaveSlug = (settings: { slug: string }) => Promise<boolean>;

/** The address as typed, its live availability check (300 ms), and the save once a new one checks out. */
function useSlugAvailability(update: SaveSlug) {
	const resume = useCurrentResume();
	const [slug, setSlug] = useState(resume.slug);
	const [debouncedSlug] = useDebounceValue(slug, 300);

	const changed = slug !== resume.slug;
	const wellFormed = isValidSlug(slug);
	const check = useQuery({
		...orpc.resume.checkSlug.queryOptions({ input: { resumeId: resume.id, slug: debouncedSlug } }),
		// Checked and saved while private too, so the address is chosen before it goes live.
		enabled: changed && wellFormed && debouncedSlug === slug,
	});
	const result = debouncedSlug === slug ? check.data : undefined;

	// Save as soon as a new address checks out; until then the current one keeps working.
	const saving = useRef<string | null>(null);
	const save = useEffectEvent((next: string) => {
		saving.current = next;
		void update({ slug: next }).finally(() => {
			saving.current = null;
		});
	});
	useEffect(() => {
		if (result?.status === "available" && saving.current !== slug) save(slug);
	}, [result?.status, slug]);

	// A save here, another tab or a restore can change the address; the field follows it unless the user is typing.
	const [savedSlug, setSavedSlug] = useState(resume.slug);
	if (resume.slug !== savedSlug) {
		setSavedSlug(resume.slug);
		if (slug === savedSlug) setSlug(resume.slug);
	}

	return { slug, setSlug, changed, wellFormed, result };
}

type AddressFieldProps = {
	url: string;
	className?: string;
	/** The row under the field (Copy link, Open web page, QR code); Copy waits while a new address isn't saved. */
	actions?: (copyDisabled: boolean) => ReactNode;
	username: string;
	/** Saves a new address; Share's one `resume.update`, so every Share control sees it pending. */
	update: SaveSlug;
};

/** The address, checked as you type. The old one stays live until the new one is valid and saved. */
export function AddressField({ url, username, update, className, actions }: AddressFieldProps) {
	const resume = useCurrentResume();
	const id = useId();
	const isPublic = resume.isPublic ?? false;
	const { slug, setSlug, changed, wellFormed, result } = useSlugAvailability(update);

	const invalid = !slug || (changed && !wellFormed) || result?.status === "taken";
	const canShare = typeof navigator.share === "function";

	// The hint under the field, when the address isn't taken (that block has its own text).
	const hint = () => {
		if (!slug) return t`Add an address.`;
		if (!changed)
			return isPublic
				? t`Live at ${url.replace(/^https?:\/\//, "")}`
				: t`Goes live at ${url.replace(/^https?:\/\//, "")} when you publish.`;
		if (slug.length > MAX_SLUG_LENGTH) return t`Use at most 64 characters.`;
		if (!wellFormed) return t`Use Latin letters a–z, numbers and single dashes.`;
		if (result?.status === "available")
			return t`Saving ${new URL(url).host}/${username}/${slug}… Copy is available after saving.`;
		return t`Checking… Copy is available after saving.`;
	};

	const host = new URL(url).host;
	// Saved and live: the address speaks for itself, so the line is only for screen readers' status updates.
	const quiet = isPublic && !changed && !invalid;

	return (
		<div className={cn("flex flex-col", className)}>
			<label htmlFor={id} className="mb-2 text-[13px]/[18px] font-medium text-ink-2">
				<Trans>Address</Trans>
			</label>
			<div className="flex items-center gap-1.5" dir="ltr">
				{/* The fixed part sits outside the field, so a long address has the field's whole width. */}
				<span className="max-w-[45%] shrink-0 truncate font-mono text-[13px]/4 font-medium text-ink-3">
					{host}/{username}/
				</span>
				<div
					className={cn(
						"flex h-10 min-w-0 flex-1 items-center overflow-hidden rounded-md border bg-raised transition-colors duration-quick focus-within:ring-3",
						invalid
							? "border-danger focus-within:border-danger focus-within:ring-danger/15"
							: "border-control-border focus-within:border-accent focus-within:ring-accent-soft",
						!isPublic && "text-ink-3",
					)}
				>
					<input
						id={id}
						value={slug}
						disabled={resume.isLocked}
						spellCheck={false}
						aria-invalid={invalid}
						aria-describedby={`${id}-message`}
						onChange={(event) => setSlug(normalizeSlug(event.target.value))}
						className="h-full min-w-0 flex-1 bg-transparent px-3 font-mono text-[13px] font-medium text-current outline-none"
					/>
					{slug && invalid && <Icon name="warning-circle" size={18} className="me-2.5 text-danger-text" />}
				</div>
			</div>
			<p
				id={`${id}-message`}
				role="status"
				className={cn(
					quiet ? "sr-only" : "pt-2 t-small [overflow-wrap:anywhere]",
					invalid ? "text-danger-text" : "text-ink-3",
				)}
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
					hint()
				)}
			</p>
			{actions?.(!isPublic || changed)}
			{isPublic && canShare && (
				<Button
					variant="ghost"
					className="mt-2 w-fit gap-1.5 pointer-fine:hidden"
					onClick={() => void navigator.share({ title: resume.name, url }).catch(() => undefined)}
				>
					<Icon name="export" size={18} />
					<Trans>Share via…</Trans>
				</Button>
			)}
		</div>
	);
}
