import type { AgentReadPosting } from "@reactive-resume/ai/tools/agent-tool-contracts";
import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@reactive-resume/ui/components/button";
import { Input } from "@reactive-resume/ui/components/input";
import { Label } from "@reactive-resume/ui/components/label";
import { toast } from "@reactive-resume/ui/components/toast";
import { pendingRequestId, settleRequestId } from "@reactive-resume/utils/string";
import { saveResumeMetadata, usePatchResume, useResumeStore } from "@/features/resume/builder/draft";
import { getAccountGeneration, getAccountId } from "@/libs/auth/account-scope";
import { toastError } from "@/libs/error-message";
import { client, orpc } from "@/libs/orpc/client";

type SavePostingProps = {
	posting: AgentReadPosting;
	resumeId: string;
	disabled: boolean;
	onSaved: (posting: { id: string; company: string; role: string }) => void;
};

/** Same create/receipt and draft-owned link path as Job match; retrieved text never becomes a write instruction. */
export function SavePosting({ posting, resumeId, disabled, onSaved }: SavePostingProps) {
	const [open, setOpen] = useState(false);
	const [company, setCompany] = useState("");
	const [role, setRole] = useState("");
	const [busy, setBusy] = useState(false);
	const [saved, setSaved] = useState(false);
	const [submitted, setSubmitted] = useState(false);
	const lock = useRef(false);
	const created = useRef<string | null>(null);
	const active = useRef(true);
	const [owner] = useState(() => ({ accountId: getAccountId(), generation: getAccountGeneration() }));
	const fieldsId = useId();
	const queryClient = useQueryClient();
	const navigate = useNavigate();
	const patchResume = usePatchResume();
	const search = useSearch({ strict: false });
	useEffect(() => {
		active.current = true;
		return () => {
			active.current = false;
		};
	}, []);
	const current = () =>
		active.current &&
		owner.accountId !== null &&
		getAccountId() === owner.accountId &&
		getAccountGeneration() === owner.generation &&
		useResumeStore.getState().resume?.id === resumeId &&
		!useResumeStore.getState().resume?.isLocked;
	const save = async () => {
		const accountId = owner.accountId;
		if (!accountId || lock.current || disabled || !company.trim() || !role.trim() || !current()) return;
		lock.current = true;
		setBusy(true);
		const job = { ...posting, company: company.trim(), role: role.trim(), resumeId };
		const key = `save-job:${owner.accountId}:${resumeId}:${JSON.stringify(job)}`;
		let applicationId: string | undefined;
		try {
			// Reconcile a possibly committed link before pending body edits use its old revision.
			const retrying = created.current !== null;
			await saveResumeMetadata(
				resumeId,
				async (expectedUpdatedAt, options) => {
					if (!current()) throw new DOMException("", "AbortError");
					const bound = { ...options, context: { accountId } };
					applicationId = created.current ?? undefined;
					const readLink = async () => {
						if (!current() || options?.signal.aborted) throw new DOMException("", "AbortError");
						const stored = await client.resume.getById({ id: resumeId }, bound);
						if (!current() || options?.signal.aborted) throw new DOMException("", "AbortError");
						return stored.id === resumeId && stored.applicationId === applicationId && !stored.isLocked ? stored : null;
					};
					if (applicationId) {
						const confirmed = await readLink().catch((error: unknown) => {
							if (!current() || options?.signal.aborted || (error instanceof Error && error.name === "AbortError"))
								throw error;
							return null;
						});
						if (confirmed) return confirmed;
					}
					setSubmitted(true);
					created.current ??= await client.applications.create({ ...job, newId: pendingRequestId(key) }, bound);
					applicationId = created.current;
					if (!current() || options?.signal.aborted) throw new DOMException("", "AbortError");
					try {
						const linked = await client.documents.linkApplication(
							{ type: "resume", id: resumeId, applicationId, expectedUpdatedAt },
							bound,
						);
						if (!linked) throw new Error(t`Couldn't link the application. Try again.`);
						return linked;
					} catch (error) {
						const confirmed = await readLink().catch(() => null);
						if (!confirmed) throw error;
						return confirmed;
					}
				},
				{ savePending: !retrying },
			);
			if (!current() || !applicationId) return;
			const id = applicationId;
			patchResume((resume) => {
				resume.applicationId = id;
			});
			void queryClient.invalidateQueries({ queryKey: orpc.applications.key() });
			void queryClient.invalidateQueries({ queryKey: orpc.documents.key() });
			// Explicit Check selections must not keep the previous job in the assistant after this link.
			await navigate({
				to: ".",
				search: (previous: typeof search) => ({ ...previous, applicationId: id }),
				replace: true,
			});
			if (!current()) return;
			onSaved({ id, company: job.company, role: job.role });
			settleRequestId(key);
			setSaved(true);
			toast.add({ description: t`Saved as a job and linked to this resume` });
		} catch (error) {
			if (current())
				toastError(
					error,
					created.current ? t`Couldn't link the application. Try again.` : t`Couldn't save the job. Try again.`,
				);
		} finally {
			lock.current = false;
			if (active.current) setBusy(false);
		}
	};
	if (saved)
		return (
			<p className="text-xs text-ink-3">
				<Trans>Saved as a job and linked to this resume</Trans>
			</p>
		);
	if (!open)
		return (
			<Button size="sm" variant="ghost" disabled={disabled} onClick={() => setOpen(true)}>
				<Trans>Save as a job…</Trans>
			</Button>
		);
	return (
		<form
			className="grid gap-2"
			onSubmit={(event) => {
				event.preventDefault();
				void save();
			}}
		>
			<p className="truncate text-xs text-ink-3">{posting.sourceUrl}</p>
			<div className="grid gap-1">
				<Label htmlFor={fieldsId}>
					<Trans>Company</Trans>
				</Label>
				<Input
					id={fieldsId}
					required
					maxLength={200}
					value={company}
					disabled={busy || submitted}
					onChange={(event) => setCompany(event.target.value)}
				/>
				<Label htmlFor={`${fieldsId}-role`}>
					<Trans>Role</Trans>
				</Label>
				<Input
					id={`${fieldsId}-role`}
					required
					maxLength={200}
					value={role}
					disabled={busy || submitted}
					onChange={(event) => setRole(event.target.value)}
				/>
			</div>
			<details className="text-xs text-ink-3">
				<summary>
					<Trans>Saved description</Trans>
				</summary>
				<p className="max-h-48 overflow-y-auto whitespace-pre-wrap">{posting.jobDescription}</p>
			</details>
			{posting.postingSource.completeness === "incomplete" && (
				<p className="text-xs text-warn-text">
					<Trans>
						This description is clipped or incomplete. Review it or paste the full description before preparing.
					</Trans>
				</p>
			)}
			<div className="flex flex-wrap gap-2">
				<Button size="sm" type="submit" loading={busy} disabled={disabled || busy || !company.trim() || !role.trim()}>
					<Trans>Save and link this resume</Trans>
				</Button>
				<Button size="sm" variant="ghost" disabled={busy} onClick={() => setOpen(false)}>
					<Trans>Cancel</Trans>
				</Button>
			</div>
		</form>
	);
}
