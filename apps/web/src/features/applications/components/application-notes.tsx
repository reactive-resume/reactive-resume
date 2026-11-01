import type { Application } from "../types";
import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useId, useLayoutEffect, useRef, useState } from "react";
import { Textarea } from "@reactive-resume/ui/components/textarea";
import { toast } from "@reactive-resume/ui/components/toast";
import { useInvalidateApplications } from "../use-application-actions";
import { DraftRecovery } from "@/features/career/draft-recovery";
import { useDebouncedSave, useSessionDraft } from "@/features/career/hooks";
import { getAccountGeneration } from "@/libs/auth/clear-account-data";
import { orpc } from "@/libs/orpc/client";

type ApplicationNotesProps = { application: Pick<Application, "id" | "notes"> };
const saves = new Map<string, Promise<void>>();
export function ApplicationNotes({ application }: ApplicationNotesProps) {
	const id = useId();
	const generation = useRef(getAccountGeneration());
	const invalidate = useInvalidateApplications();
	const queryClient = useQueryClient();
	const draft = useSessionDraft(
		`notes:${application.id}`,
		application.notes ?? "",
		(value) => (typeof value === "string" ? value : undefined),
		true,
	);
	const [saved, setSaved] = useState(application.notes ?? "");
	const latest = useRef(draft);
	useLayoutEffect(() => {
		latest.current = draft;
	});
	const { mutateAsync, isError } = useMutation({
		...orpc.applications.update.mutationOptions(),
		onSuccess: () => invalidate(application.id),
		onError: () => toast.add({ type: "error", description: t`Couldn't save the notes. Try again.` }),
	});
	const save = (value: string) => {
		const key = draft.key;
		if (key === null) return;
		const pending = (saves.get(key) ?? Promise.resolve())
			.then(async () => {
				if (generation.current !== getAccountGeneration()) return;
				await mutateAsync({ id: application.id, notes: value.trim() ? value : null });
				if (generation.current !== getAccountGeneration()) return;
				queryClient.setQueryData<Application>(
					orpc.applications.getById.queryKey({ input: { id: application.id } }),
					(current) => (current ? { ...current, notes: value.trim() ? value : null } : current),
				);
				setSaved(value);
				latest.current.clear(value);
			})
			.catch(() => {})
			.finally(() => {
				if (saves.get(key) === pending) saves.delete(key);
			});
		saves.set(key, pending);
	};
	const flush = useDebouncedSave(draft.restored ? saved : draft.value, saved, save, 800);
	return (
		<section className="grid gap-2">
			<DraftRecovery {...draft} />
			<label htmlFor={id} className="text-xs font-semibold text-ink-3">
				<Trans>Notes</Trans>
			</label>
			<Textarea
				id={id}
				rows={3}
				value={draft.value}
				placeholder={t`Anything to remember about this job`}
				onBlur={flush}
				onChange={(event) => draft.setValue(event.target.value)}
			/>
			{isError && (
				<button type="button" onClick={() => flush(true)} className="justify-self-start text-sm underline">
					<Trans>Retry save</Trans>
				</button>
			)}
		</section>
	);
}
