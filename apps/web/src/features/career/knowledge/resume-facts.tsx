import type { RouterOutput } from "@/libs/orpc/client";
import { plural, t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouteContext } from "@tanstack/react-router";
import { useEffect, useId, useRef, useState } from "react";
import { MAX_RESUME_FACT_CHARACTERS } from "@reactive-resume/schema/career";
import { Button } from "@reactive-resume/ui/components/button";
import { Checkbox } from "@reactive-resume/ui/components/checkbox";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@reactive-resume/ui/components/dialog";
import { Icon } from "@reactive-resume/ui/components/icon";
import { Label } from "@reactive-resume/ui/components/label";
import { NativeSelect } from "@reactive-resume/ui/components/native-select";
import { CATEGORIES, categoryLabel } from "./fact-categories";
import { getAccountGeneration, getAccountId } from "@/libs/auth/account-scope";
import { getOrpcErrorMessage } from "@/libs/error-message";
import { client, orpc } from "@/libs/orpc/client";

type Review = RouterOutput["career"]["proposeResumeFacts"];
type Draft = Review["proposals"][number] & { selected: boolean };

/** C10: pull facts from a resume. Runs on the server from the resume's own text; nothing goes to an AI provider. */
export function ResumeFacts() {
	const { session } = useRouteContext({ strict: false });
	const [open, setOpen] = useState(false);
	return (
		<>
			<Button variant="ghost" onClick={() => setOpen(true)}>
				<Icon name="file-text" />
				<Trans>Pull from my resume</Trans>
			</Button>
			<Dialog open={open} onOpenChange={setOpen}>
				<DialogContent closeLabel={t`Close`}>
					{/* Mounted only while open, and per account: a cancelled or old-account review never shows late. */}
					{open && <ReviewResumeFacts key={session?.user.id} onClose={() => setOpen(false)} />}
				</DialogContent>
			</Dialog>
		</>
	);
}

type ReviewResumeFactsProps = { onClose: () => void };
function ReviewResumeFacts({ onClose }: ReviewResumeFactsProps) {
	const id = useId();
	const queryClient = useQueryClient();
	const [account] = useState(() => ({ id: getAccountId(), generation: getAccountGeneration() }));
	const alive = useRef(true);
	useEffect(() => {
		alive.current = true;
		return () => {
			alive.current = false;
		};
	}, []);
	const current = () =>
		alive.current &&
		account.id !== null &&
		account.id === getAccountId() &&
		account.generation === getAccountGeneration();
	const documents = useQuery(orpc.documents.list.queryOptions({ input: { trashed: false } }));
	const [resumeId, setResumeId] = useState("");
	const [review, setReview] = useState<Review | null>(null);
	const [drafts, setDrafts] = useState<Draft[]>([]);
	const [receipt, setReceipt] = useState<string | null>(null);
	const preview = useMutation({
		mutationFn: (resume: string) => {
			if (!current() || !account.id) throw new Error("Account changed");
			return client.career.proposeResumeFacts({ resumeId: resume }, { context: { accountId: account.id } });
		},
		onSuccess: (result) => {
			if (current()) {
				setReview(result);
				setDrafts(result.proposals.map((item) => ({ ...item, selected: true })));
			}
		},
	});
	const save = useMutation({
		mutationFn: () => {
			if (!current() || !account.id || !review) throw new Error("Account changed");
			return client.career.saveResumeFacts(
				{
					resumeId: review.id,
					updatedAt: review.updatedAt,
					proposals: drafts.filter((item) => item.selected).map(({ selected: _selected, ...item }) => item),
				},
				{ context: { accountId: account.id } },
			);
		},
		onSuccess: (result) => {
			if (current()) {
				setReview(null);
				setDrafts([]);
				setReceipt(
					t`Saved: ${result.saved}. Skipped: ${result.skipped}. Existing, corrected or switched-off facts stay unchanged.`,
				);
				void queryClient.invalidateQueries({ queryKey: orpc.career.facts.key() });
			}
		},
	});
	const busy = preview.isPending || save.isPending;
	const selected = drafts.filter((item) => item.selected);
	const error = preview.error ?? save.error;
	const change = (index: number, patch: Partial<Draft>) =>
		setDrafts((items) => items.map((item, i) => (i === index ? { ...item, ...patch } : item)));
	// Choosing a resume reads it at once: there is nothing else to decide before the review.
	const choose = (resume: string) => {
		setResumeId(resume);
		setReview(null);
		setDrafts([]);
		setReceipt(null);
		preview.reset();
		save.reset();
		if (resume) preview.mutate(resume);
	};
	const resumes = documents.data?.filter((row) => row.type === "resume") ?? [];

	return (
		<>
			<DialogHeader>
				<DialogTitle>
					<Trans>Pull facts from my resume</Trans>
				</DialogTitle>
				<DialogDescription>
					<Trans>Only the facts you tick are saved, for all applications. Nothing goes to an AI provider.</Trans>
				</DialogDescription>
			</DialogHeader>
			<div className="grid gap-1.5">
				<Label htmlFor={id}>
					<Trans>Resume</Trans>
				</Label>
				<NativeSelect
					id={id}
					value={resumeId}
					disabled={busy || !documents.isSuccess}
					onChange={(event) => choose(event.target.value)}
				>
					<option value="">{t`Choose a resume`}</option>
					{resumes.map((row) => (
						<option key={row.id} value={row.id}>
							{row.name}
						</option>
					))}
				</NativeSelect>
			</div>
			{documents.isError && (
				<Button variant="secondary" onClick={() => void documents.refetch()}>
					<Trans>Retry documents</Trans>
				</Button>
			)}
			{documents.isSuccess && resumes.length === 0 && (
				<p role="status" className="text-ink-2">
					<Trans>Create or import a resume in Documents first.</Trans>
				</p>
			)}
			{preview.isPending && (
				<p role="status" className="t-small text-ink-3">
					<Trans>Reading the resume…</Trans>
				</p>
			)}
			{error && (
				<div role="alert" className="grid justify-items-start gap-2 text-sm text-danger-text">
					{getOrpcErrorMessage(error, {
						fallback: t`Couldn't load or save resume facts. Try again.`,
						allowServerMessage: true,
					})}
					{preview.isError && resumeId && (
						<Button variant="secondary" size="sm" onClick={() => choose(resumeId)}>
							<Trans>Try again</Trans>
						</Button>
					)}
				</div>
			)}
			{receipt && (
				<p role="status" className="text-ink-2">
					{receipt}
				</p>
			)}
			{review && (
				<div className="grid" aria-label={t`Resume fact proposals`}>
					{drafts.length > 0 ? (
						<div className="flex items-center justify-between gap-2 border-b border-line pb-2 t-small text-ink-2">
							{plural(drafts.length, {
								one: "Found # fact you don't have yet",
								other: "Found # facts you don't have yet",
							})}
							<button
								type="button"
								disabled={save.isPending}
								onClick={() => {
									const all = selected.length === drafts.length;
									setDrafts((items) => items.map((item) => ({ ...item, selected: !all })));
								}}
								className="rounded-xs font-medium text-accent-text hover:underline"
							>
								{selected.length === drafts.length ? <Trans>Select none</Trans> : <Trans>Select all</Trans>}
							</button>
						</div>
					) : (
						<p role="status" className="text-ink-2">
							<Trans>No supported excerpts found. Add a fact manually or choose another resume.</Trans>
						</p>
					)}
					{drafts.map((item, index) => (
						<fieldset
							key={item.quote}
							disabled={save.isPending}
							className="flex items-start gap-3 border-b border-line py-2.5"
						>
							<Checkbox
								checked={item.selected}
								aria-label={t`Save this fact: ${item.text}`}
								onCheckedChange={(checked) => change(index, { selected: checked })}
								className="mt-0.5"
							/>
							<div className="grid min-w-0 flex-1 gap-0.5">
								<textarea
									aria-label={t`Fact`}
									rows={1}
									value={item.text}
									// HTML counts UTF-16 units; the handler enforces the Unicode character limit.
									maxLength={MAX_RESUME_FACT_CHARACTERS * 2}
									onChange={(event) => {
										const text = event.target.value;
										if (Array.from(text).length <= MAX_RESUME_FACT_CHARACTERS) change(index, { text });
									}}
									className="field-sizing-content w-full resize-none rounded-xs bg-transparent text-[15px]/[22px] font-medium text-ink outline-none focus:shadow-[0_1px_0_0_var(--accent)] focus-visible:outline-none"
								/>
								<p className="line-clamp-2 t-small text-ink-3">
									<select
										aria-label={t`Type`}
										value={item.category}
										onChange={(event) => change(index, { category: event.target.value as Draft["category"] })}
										className="field-sizing-content cursor-pointer appearance-none rounded-xs bg-transparent text-ink-2 underline decoration-line-2 underline-offset-2 outline-none hover:text-ink"
									>
										{CATEGORIES.map((category) => (
											<option key={category} value={category}>
												{categoryLabel(category)}
											</option>
										))}
									</select>{" "}
									· <Trans>from “{item.quote}”</Trans>
								</p>
							</div>
						</fieldset>
					))}
					{review.omitted > 0 && (
						<p role="status" className="pt-2 text-xs/4 text-ink-3">
							<Trans>Some resume text was left out; add other facts yourself.</Trans>
						</p>
					)}
				</div>
			)}
			<DialogFooter>
				<Button variant="ghost" disabled={save.isPending} onClick={onClose}>
					{receipt ? <Trans>Done</Trans> : <Trans>Cancel</Trans>}
				</Button>
				{drafts.length > 0 && (
					<Button
						loading={save.isPending}
						disabled={!selected.length || selected.some((item) => !item.text.trim()) || busy}
						onClick={() => save.mutate()}
					>
						{plural(selected.length, { one: "Save # fact", other: "Save # facts" })}
					</Button>
				)}
			</DialogFooter>
		</>
	);
}
