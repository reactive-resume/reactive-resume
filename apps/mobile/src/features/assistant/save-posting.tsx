import type { AgentReadPosting } from "@reactive-resume/ai/tools/agent-tool-contracts";
import { useLingui } from "@lingui/react/macro";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { View } from "react-native";
import { pendingRequestId, settleRequestId } from "@reactive-resume/utils/string";
import { client, orpc, SessionChangedError } from "@/api/client";
import { getAccountScope } from "@/auth/session";
import { useResumeStore } from "@/draft";
import { resume as draftResume } from "@/draft/runtime";
import { flushResume } from "@/features/share/document";
import { Button, Text, TextField, useTheme } from "@/ui";

type SavePostingProps = {
	posting: AgentReadPosting;
	resumeId: string;
	disabled: boolean;
	onSaved: (posting: { id: string; company: string; role: string }) => void;
};

/** Confirms the link through the draft owner, including a committed write whose response was lost. */
export function SavePosting({ posting, resumeId, disabled, onSaved }: SavePostingProps) {
	const { t } = useLingui();
	const { space } = useTheme();
	const queryClient = useQueryClient();
	const [scope] = useState(getAccountScope);
	const [open, setOpen] = useState(false);
	const [company, setCompany] = useState("");
	const [role, setRole] = useState("");
	const [description, showDescription] = useState(false);
	const [busy, setBusy] = useState(false);
	const [submitted, setSubmitted] = useState(false);
	const [saved, setSaved] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const lock = useRef(false);
	const created = useRef<string | null>(null);
	const controller = useRef<AbortController | null>(null);
	const active = useRef(true);
	useEffect(() => {
		active.current = true;
		return () => {
			active.current = false;
			controller.current?.abort();
		};
	}, []);
	const check = () => {
		if (
			!active.current ||
			!scope ||
			getAccountScope() !== scope ||
			useResumeStore.getState().document?.id !== resumeId ||
			useResumeStore.getState().locked
		)
			throw new SessionChangedError();
	};
	const save = async () => {
		if (!scope || lock.current || disabled || !company.trim() || !role.trim()) return;
		lock.current = true;
		setBusy(true);
		setError(null);
		const request = new AbortController();
		controller.current = request;
		const job = { ...posting, company: company.trim(), role: role.trim(), resumeId };
		const key = `save-job:${scope}:${resumeId}:${JSON.stringify(job)}`;
		try {
			check();
			// A retry may already be linked: reconcile its revision before flushing newer local edits.
			if (!created.current) await flushResume(resumeId);
			check();
			const options = { signal: request.signal, context: { scope } };
			await draftResume.writeMetadata(
				async (baseline) => {
					check();
					if (baseline.id !== resumeId) throw new SessionChangedError();
					const readLink = async () => {
						check();
						request.signal.throwIfAborted();
						const stored = await client.resume.getById({ id: resumeId }, options);
						check();
						request.signal.throwIfAborted();
						return stored.id === resumeId && stored.applicationId === created.current && !stored.isLocked
							? stored
							: null;
					};
					if (created.current) {
						const confirmed = await readLink().catch((error: unknown) => {
							check();
							request.signal.throwIfAborted();
							if (error instanceof Error && error.name === "AbortError") throw error;
							return null;
						});
						if (confirmed) return confirmed;
					}
					setSubmitted(true);
					created.current ??= await client.applications.create({ ...job, newId: pendingRequestId(key) }, options);
					check();
					request.signal.throwIfAborted();
					try {
						const linked = await client.documents.linkApplication(
							{ type: "resume", id: resumeId, applicationId: created.current, expectedUpdatedAt: baseline.updatedAt },
							options,
						);
						if (!linked) throw new Error(t`Couldn't link the application. Try again.`);
						return { ...baseline, ...linked };
					} catch (error) {
						const confirmed = await readLink().catch(() => null);
						if (!confirmed) throw error;
						return confirmed;
					}
				},
				// A readback is not a conditional write: another body's revision must not become this draft's own.
				{ conditional: false },
			);
			check();
			if (!created.current) return;
			settleRequestId(key);
			setSaved(true);
			void queryClient.invalidateQueries({ queryKey: orpc.applications.key() });
			void queryClient.invalidateQueries({ queryKey: orpc.documents.key() });
			onSaved({ id: created.current, company: job.company, role: job.role });
		} catch {
			if (active.current && getAccountScope() === scope)
				setError(created.current ? t`Couldn't link the application. Try again.` : t`Couldn't save the job. Try again.`);
		} finally {
			lock.current = false;
			if (active.current) setBusy(false);
		}
	};
	if (saved) return <Text variant="caption" color="ink3">{t`Saved as a job and linked to this resume`}</Text>;
	if (!open)
		return (
			<Button size="sm" variant="link" disabled={disabled} label={t`Save as a job…`} onPress={() => setOpen(true)} />
		);
	return (
		<View style={{ gap: space.s2 }}>
			<Text variant="caption" color="ink3">
				{posting.sourceUrl}
			</Text>
			<TextField
				label={t`Company`}
				value={company}
				maxLength={200}
				editable={!busy && !submitted}
				onChangeText={setCompany}
			/>
			<TextField label={t`Role`} value={role} maxLength={200} editable={!busy && !submitted} onChangeText={setRole} />
			<Button
				variant="link"
				size="sm"
				label={t`Saved description`}
				onPress={() => showDescription((value) => !value)}
			/>
			{description ? (
				<Text variant="caption" color="ink3">
					{posting.jobDescription}
				</Text>
			) : null}
			{posting.postingSource.completeness === "incomplete" ? (
				<Text
					variant="caption"
					color="ink3"
				>{t`This description is clipped or incomplete. Review it or paste the full description before preparing.`}</Text>
			) : null}
			{error ? (
				<Text accessibilityRole="alert" color="dangerText">
					{error}
				</Text>
			) : null}
			<Button
				size="sm"
				label={t`Save and link this resume`}
				loading={busy}
				disabled={disabled || busy || !company.trim() || !role.trim()}
				onPress={() => void save()}
			/>
			<Button size="sm" variant="link" label={t`Cancel`} disabled={busy} onPress={() => setOpen(false)} />
		</View>
	);
}
