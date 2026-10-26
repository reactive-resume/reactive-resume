import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useEffectEvent, useId, useRef, useState } from "react";
import { useDebounceValue } from "usehooks-ts";
import { normalizeSlug, SLUG_PATTERN } from "@reactive-resume/resume/sharing";
import { Button } from "@reactive-resume/ui/components/button";
import { Icon } from "@reactive-resume/ui/components/icon";
import { cn } from "@reactive-resume/utils/style";
import { CopyLinkButton } from "./copy-link-button";
import { useCurrentResume } from "@/features/resume/builder/draft";
import { orpc } from "@/libs/orpc/client";

type SaveSlug = (settings: { slug: string }) => Promise<boolean>;

/** The address as typed, its live availability check (300 ms), and the save once a new one checks out. */
function useSlugAvailability(update: SaveSlug) {
	const resume = useCurrentResume();
	const [slug, setSlug] = useState(resume.slug);
	const [debouncedSlug] = useDebounceValue(slug, 300);

	const changed = slug !== resume.slug;
	const wellFormed = SLUG_PATTERN.test(slug);
	const check = useQuery({
		...orpc.resume.checkSlug.queryOptions({ input: { resumeId: resume.id, slug: debouncedSlug } }),
		enabled: (resume.isPublic ?? false) && changed && wellFormed && debouncedSlug === slug,
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
	username: string;
	/** Saves a new address; Share's one `resume.update`, so every Share control sees it pending. */
	update: SaveSlug;
};

/** The address, checked as you type. The old one stays live until the new one is valid and saved. */
export function AddressField({ url, username, update }: AddressFieldProps) {
	const resume = useCurrentResume();
	const id = useId();
	const isPublic = resume.isPublic ?? false;
	const { slug, setSlug, changed, wellFormed, result } = useSlugAvailability(update);

	const invalid = isPublic && (!slug || !wellFormed || result?.status === "taken");
	const canShare = typeof navigator.share === "function";

	// The hint under the field, when the address isn't taken (that block has its own text).
	const hint = () => {
		if (!isPublic) return t`Turn on the link to choose an address.`;
		if (!slug) return t`Add an address.`;
		if (!wellFormed) return t`Use lowercase letters, numbers and single dashes.`;
		if (!changed) return t`Live at ${url.replace(/^https?:\/\//, "")}`;
		if (result?.status === "available")
			return t`Saving ${new URL(url).host}/${username}/${slug}… Copy is available after saving.`;
		return t`Checking… Copy is available after saving.`;
	};

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
						{new URL(url).host}/{username}/
					</span>
					<input
						id={id}
						value={slug}
						disabled={!isPublic || resume.isLocked}
						spellCheck={false}
						aria-invalid={invalid}
						aria-describedby={`${id}-message`}
						onChange={(event) => setSlug(normalizeSlug(event.target.value))}
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
				<CopyLinkButton url={url} className="h-[38px] gap-1.5" disabled={!isPublic || changed} />
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
					hint()
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
