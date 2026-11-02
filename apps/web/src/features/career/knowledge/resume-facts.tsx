import type { RouterOutput } from "@/libs/orpc/client";
import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouteContext } from "@tanstack/react-router";
import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@reactive-resume/ui/components/button";
import { NativeSelect } from "@reactive-resume/ui/components/native-select";
import { Textarea } from "@reactive-resume/ui/components/textarea";
import { CATEGORIES, categoryLabel } from "./fact-categories";
import { getAccountGeneration, getAccountId } from "@/libs/auth/account-scope";
import { getOrpcErrorMessage } from "@/libs/error-message";
import { client, orpc } from "@/libs/orpc/client";

type Review = RouterOutput["career"]["proposeResumeFacts"];
type Draft = Review["proposals"][number] & { selected: boolean };

export function ResumeFacts() {
	const { session } = useRouteContext({ strict: false });
	const [open, setOpen] = useState(false);
	return (
		<section className="grid gap-3 rounded-xl border border-line p-3">
			{open ? (
				<ReviewResumeFacts key={session?.user.id} onClose={() => setOpen(false)} />
			) : (
				<Button variant="secondary" onClick={() => setOpen(true)}>
					<Trans>Pull facts from my resume</Trans>
				</Button>
			)}
		</section>
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
		mutationFn: () => {
			if (!current() || !account.id) throw new Error("Account changed");
			return client.career.proposeResumeFacts({ resumeId }, { context: { accountId: account.id } });
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
	return (
		<>
			<h3 className="font-semibold">
				<Trans>Pull facts from my resume</Trans>
			</h3>
			<p className="text-sm text-ink-3">
				<Trans>
					Choose a resume, then review its excerpts. Nothing goes to an AI provider. Only selected facts are saved to
					Knowledge for all applications.
				</Trans>
			</p>
			<label htmlFor={id}>
				<Trans>Resume</Trans>
			</label>
			<NativeSelect
				id={id}
				value={resumeId}
				disabled={busy || !documents.isSuccess}
				onChange={(event) => {
					setResumeId(event.target.value);
					setReview(null);
					setDrafts([]);
					setReceipt(null);
					preview.reset();
					save.reset();
				}}
			>
				<option value="">{t`Choose a resume`}</option>
				{documents.data
					?.filter((row) => row.type === "resume")
					.map((row) => (
						<option key={row.id} value={row.id}>
							{row.name}
						</option>
					))}
			</NativeSelect>
			{documents.isError && (
				<Button variant="secondary" onClick={() => void documents.refetch()}>
					<Trans>Retry documents</Trans>
				</Button>
			)}
			{documents.isSuccess && !documents.data.some((row) => row.type === "resume") && (
				<p role="status">
					<Trans>Create or import a resume in Documents first.</Trans>
				</p>
			)}
			<Button
				variant="secondary"
				disabled={!resumeId || busy}
				loading={preview.isPending}
				onClick={() => {
					setReview(null);
					setDrafts([]);
					setReceipt(null);
					save.reset();
					preview.mutate();
				}}
			>
				<Trans>Review resume facts</Trans>
			</Button>
			{error && (
				<p role="alert" className="text-sm text-danger-text">
					{getOrpcErrorMessage(error, {
						fallback: t`Couldn't load or save resume facts. Try again.`,
						allowServerMessage: true,
					})}
				</p>
			)}
			{receipt && <p role="status">{receipt}</p>}
			{review && (
				<div className="grid gap-3" aria-label={t`Resume fact proposals`}>
					<p className="text-sm">{review.name}</p>
					{!drafts.length && (
						<p role="status">
							<Trans>No supported excerpts found. Add a fact manually or choose another resume.</Trans>
						</p>
					)}
					{review.omitted > 0 && (
						<p role="status">
							<Trans>Some resume text was left out. Add other facts manually.</Trans>
						</p>
					)}
					{drafts.map((item, index) => (
						<fieldset
							key={item.quote}
							className="grid gap-2 rounded-lg border border-line p-3"
							disabled={save.isPending}
						>
							<label className="flex min-h-11 items-center gap-2">
								<input
									type="checkbox"
									checked={item.selected}
									onChange={(event) => change(index, { selected: event.target.checked })}
								/>{" "}
								<Trans>Save this fact</Trans>
							</label>
							<label htmlFor={`${id}-fact-${index}`}>
								<Trans>Fact</Trans>
							</label>
							<Textarea
								id={`${id}-fact-${index}`}
								value={item.text}
								maxLength={2000}
								onChange={(event) => change(index, { text: event.target.value })}
							/>
							<label htmlFor={`${id}-type-${index}`}>
								<Trans>Type</Trans>
							</label>
							<NativeSelect
								id={`${id}-type-${index}`}
								value={item.category}
								onChange={(event) => change(index, { category: event.target.value as Draft["category"] })}
							>
								{CATEGORIES.map((category) => (
									<option key={category} value={category}>
										{categoryLabel(category)}
									</option>
								))}
							</NativeSelect>
							<details>
								<summary className="cursor-pointer text-sm">
									<Trans>Source quotation</Trans>
								</summary>
								<blockquote className="text-sm whitespace-pre-wrap text-ink-3">{item.quote}</blockquote>
							</details>
						</fieldset>
					))}
					{!!drafts.length && (
						<Button
							loading={save.isPending}
							disabled={!selected.length || selected.some((item) => !item.text.trim()) || busy}
							onClick={() => save.mutate()}
						>
							<Trans>Save selected facts</Trans>
						</Button>
					)}
				</div>
			)}
			<Button variant="ghost" disabled={save.isPending} onClick={onClose}>
				<Trans>Cancel</Trans>
			</Button>
		</>
	);
}
