import type { VersionSummary } from "./format";
import type { Resume } from "@/features/resume/builder/draft";
import { t } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import { Trans } from "@lingui/react/macro";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";
import { Badge } from "@reactive-resume/ui/components/badge";
import { Button } from "@reactive-resume/ui/components/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@reactive-resume/ui/components/dropdown-menu";
import { Icon } from "@reactive-resume/ui/components/icon";
import { IconButton } from "@reactive-resume/ui/components/icon-button";
import { Input } from "@reactive-resume/ui/components/input";
import { toast } from "@reactive-resume/ui/components/toast";
import { cn } from "@reactive-resume/utils/style";
import { formatVersionMoment, formatVersionTime, getVersionDetail, getVersionTitle } from "./format";
import { rowGroundClassName, rowLinkClassName } from "@/components/calm/list-row";
import { AiResultUsage } from "@/features/ai/usage";
import {
	savePendingChanges,
	useCurrentResume,
	useResumeStore,
	withOwnServerWrite,
} from "@/features/resume/builder/draft";
import { useEditorStore } from "@/features/resume/editor/store";
import { useConfirm, usePrompt } from "@/hooks/use-confirm";
import { getResumeErrorMessage } from "@/libs/error-message";
import { orpc } from "@/libs/orpc/client";

/** A version as History lists it; resumes and letters share it. */
type HistoryVersion = Pick<VersionSummary, "id" | "kind" | "name" | "createdAt">;

/** What History shows and does for one document: its versions, and saving, restoring, renaming and deleting them. */
export type HistorySource = {
	versions: HistoryVersion[] | undefined;
	loading: boolean;
	/** Locked documents can't be restored over. */
	locked: boolean;
	/** "The resume as it is", under Now. */
	nowDetail: string;
	/** Saves the current state as a named version. Throws what the request throws. */
	save: (name: string) => Promise<void>;
	/** Restores a version (the current state is kept as "Before restore" first). Throws what the request throws. */
	restore: (versionId: string) => Promise<void>;
	rename: (versionId: string, name: string) => Promise<void>;
	remove: (versionId: string) => Promise<void>;
	/** How a failure reads. */
	errorMessage: (error: unknown) => string;
	/** The label over the name field; "Name the resume as it is now" by default. */
	nameLabel?: string;
};

/** History for the resume in the editor. */
export function HistoryTab() {
	const resume = useCurrentResume();
	const versionId = useEditorStore((state) => state.historyVersionId);
	const version = useQuery({
		...orpc.resume.getVersion.queryOptions({ input: { resumeId: resume.id, versionId: versionId ?? "" } }),
		enabled: versionId !== null,
	});
	const selected = versionId && version.data?.id === versionId ? version.data : null;
	return (
		<>
			{selected ? (
				<AiResultUsage usage={selected.aiUsage} />
			) : !versionId && (resume.aiOperationIds?.length ?? 0) > 0 ? (
				<AiResultUsage usage={resume.aiUsage} />
			) : null}
			<HistoryTimeline source={useResumeHistory()} />
		</>
	);
}

function useResumeHistory(): HistorySource {
	const resume = useCurrentResume();
	const queryClient = useQueryClient();
	const listKey = orpc.resume.listVersions.queryKey({ input: { resumeId: resume.id } });
	const { data: versions, isPending: loading } = useQuery(
		orpc.resume.listVersions.queryOptions({ input: { resumeId: resume.id } }),
	);
	const refresh = () => queryClient.invalidateQueries({ queryKey: listKey });

	return {
		versions,
		loading,
		locked: resume.isLocked,
		nowDetail: t`The resume as it is`,
		errorMessage: getResumeErrorMessage,
		save: async (name) => {
			if (!(await savePendingChanges(resume.id)))
				throw new Error(t`Couldn't save your changes. Try again before continuing.`);
			await orpc.resume.createVersion.call({ resumeId: resume.id, name });
			void refresh();
		},
		restore: async (versionId) => {
			if (!(await savePendingChanges(resume.id)))
				throw new Error(t`Couldn't save your changes. Try again before continuing.`);
			const restored = await withOwnServerWrite(resume.id, () =>
				orpc.resume.restoreVersion.call({ resumeId: resume.id, versionId, proposalSafety: "v1" }),
			);
			useResumeStore.getState().replaceResumeFromServer(restored as Resume);
			queryClient.setQueryData(orpc.resume.getById.queryKey({ input: { id: resume.id } }), {
				...restored,
				applicationId: resume.applicationId ?? null,
			});
			void refresh();
		},
		rename: async (versionId, name) => {
			await orpc.resume.renameVersion.call({ resumeId: resume.id, versionId, name });
			void refresh();
		},
		remove: async (versionId) => {
			await orpc.resume.deleteVersion.call({ resumeId: resume.id, versionId });
			void refresh();
		},
	};
}

/**
 * History: name the current state, or pick any version to see it on the page, read-only, then restore it or
 * go back to now. Restoring saves the current state as "Before restore" first, so it can be undone.
 */
export function HistoryTimeline({ source }: { source: HistorySource }) {
	const { i18n } = useLingui();
	const selectedId = useEditorStore((state) => state.historyVersionId);
	const [name, setName] = useState("");
	const [busy, setBusy] = useState(false);
	const nameId = useId();
	const { versions } = source;

	const selected = versions?.find((version) => version.id === selectedId) ?? null;
	const when = (version: HistoryVersion) => formatVersionTime(version.createdAt, i18n.locale);

	const run = async (action: () => Promise<void>) => {
		setBusy(true);
		try {
			await action();
		} catch (error) {
			toast.add({ type: "error", description: source.errorMessage(error) });
		}
		setBusy(false);
	};

	const save = () => {
		const trimmed = name.trim();
		if (!trimmed) return;
		void run(async () => {
			await source.save(trimmed);
			setName("");
			toast.add({ description: t`Saved “${trimmed}”` });
		});
	};

	const restore = (version: HistoryVersion) =>
		void run(async () => {
			await source.restore(version.id);
			useEditorStore.setState({ historyVersionId: null });
			toast.add({
				description: version.name
					? t`Restored “${version.name}”. Your previous state is saved as “Before restoring “${version.name}””.`
					: t`Restored the version from ${formatVersionMoment(version.createdAt, i18n.locale)}. Your previous state is saved as “Before restore”.`,
			});
		});

	return (
		<div className="flex min-h-0 flex-1 flex-col">
			<form
				className="flex flex-col"
				onSubmit={(event) => {
					event.preventDefault();
					save();
				}}
			>
				<label htmlFor={nameId} className="mb-2 text-[13px]/[18px] font-medium text-ink-2">
					{source.nameLabel ?? <Trans>Name the resume as it is now</Trans>}
				</label>
				<div className="flex gap-2">
					<Input
						id={nameId}
						value={name}
						maxLength={80}
						placeholder={t`For example, Before the rewrite`}
						onChange={(event) => setName(event.target.value)}
						className="h-9"
					/>
					<Button type="submit" variant="secondary" disabled={!name.trim() || busy}>
						<Trans>Save version</Trans>
					</Button>
				</div>
			</form>

			{selected && (
				<div role="status" className="mt-4 grid gap-2.5 rounded-lg bg-sunken p-3">
					<span className="flex items-start gap-2.5">
						<Icon name={versionIcon(selected) ?? "clock-counter-clockwise"} size={18} className="mt-px text-ink-2" />
						<span className="flex min-w-0 flex-col">
							<span className="text-sm font-semibold text-ink">
								{getVersionTitle(selected)} · {when(selected)}
							</span>
							<span className="text-xs/4 text-ink-3">
								{selected.kind === "sent" ? (
									<Trans>What went out with your application. Read-only.</Trans>
								) : (
									<Trans>Shown on the page, read-only.</Trans>
								)}
							</span>
						</span>
					</span>
					<span className="flex flex-wrap gap-2">
						<Button size="sm" variant="secondary" disabled={source.locked || busy} onClick={() => restore(selected)}>
							<Icon name="arrow-counter-clockwise" />
							<Trans>Restore this version</Trans>
						</Button>
						<Button size="sm" variant="ghost" onClick={() => useEditorStore.setState({ historyVersionId: null })}>
							<Trans>Back to now</Trans>
						</Button>
					</span>
				</div>
			)}

			<ol className="mt-4 flex flex-col" aria-label={t`Versions, newest first`}>
				<TimelineItem
					title={t`Now`}
					detail={source.nowDetail}
					selected={!selected}
					current
					onSelect={() => useEditorStore.setState({ historyVersionId: null })}
				/>
				{versions?.map((version) => (
					<TimelineItem
						key={version.id}
						title={getVersionTitle(version)}
						detail={`${when(version)} · ${getVersionDetail(version)}`}
						icon={versionIcon(version)}
						selected={version.id === selectedId}
						onSelect={() => useEditorStore.setState({ historyVersionId: version.id })}
						trailing={
							version.kind === "named" ? (
								<NamedVersionMenu version={version} source={source} />
							) : version.kind === "sent" ? (
								<Badge variant="outline">
									<Icon name="lock-simple" size={14} />
									<Trans>Frozen</Trans>
								</Badge>
							) : null
						}
					/>
				))}
			</ol>

			<p className="mt-auto border-t border-line pt-3.5 pb-5 t-small text-ink-3">
				<Trans>
					Autosaves are grouped by session and kept for 90 days. Named and sent versions are kept. Restoring saves the
					current state first, so nothing is lost.
				</Trans>
			</p>
		</div>
	);
}

/** Named versions carry a bookmark, sent ones a paper plane; the rest a dot. */
const versionIcon = (version: HistoryVersion) =>
	version.kind === "named" ? "bookmark-simple" : version.kind === "sent" ? "paper-plane-tilt" : undefined;

type TimelineItemProps = {
	title: string;
	detail: string;
	selected: boolean;
	onSelect: () => void;
	current?: boolean;
	icon?: "bookmark-simple" | "paper-plane-tilt" | undefined;
	trailing?: React.ReactNode;
};

/** One version: a 20px mark, its title and how it was saved; the whole row picks it. */
function TimelineItem({ title, detail, selected, onSelect, current, icon, trailing }: TimelineItemProps) {
	return (
		<li
			className={cn(
				rowGroundClassName,
				"flex min-h-(--row) items-center gap-3.5 border-b border-line py-2.5 last:border-b-0 hover:border-transparent hover:before:bg-hover",
				selected && !current && "border-transparent before:bg-accent-soft hover:before:bg-accent-soft",
			)}
		>
			<span aria-hidden="true" className="flex w-5 shrink-0 justify-center text-ink-3">
				{icon ? (
					<Icon name={icon} size={18} />
				) : (
					<span className={cn("size-1.5 rounded-full", current ? "bg-accent" : "bg-line-2")} />
				)}
			</span>
			<button
				type="button"
				aria-pressed={selected}
				onClick={onSelect}
				className={cn("flex min-w-0 flex-1 flex-col gap-px text-start", rowLinkClassName)}
			>
				<span className="truncate text-[15px]/[22px] font-medium text-ink">{title}</span>
				<span className="truncate text-[13px]/[18px] text-ink-3">{detail}</span>
			</button>
			{trailing && <span className="relative z-10 flex shrink-0 items-center">{trailing}</span>}
		</li>
	);
}

type HistoryPanelProps = { onClose: () => void; children: React.ReactNode };

/** B15: History in the panel's place, with its own 56px title row and close. */
export function HistoryPanel({ onClose, children }: HistoryPanelProps) {
	return (
		<div className="flex min-h-0 flex-1 flex-col">
			<div className="flex h-14 shrink-0 items-center ps-6 pe-2.5">
				<h2 className="flex-1 t-page-title">
					<Trans>History</Trans>
				</h2>
				<IconButton icon="x" label={t`Close history and go back to now`} onClick={onClose} />
			</div>
			<div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-6 pt-1 [overflow-anchor:none]">{children}</div>
		</div>
	);
}

/** Named versions are the user's own: they can be renamed or deleted. The rest expire on their own. */
function NamedVersionMenu({ version, source }: { version: HistoryVersion; source: HistorySource }) {
	const prompt = usePrompt();
	const confirm = useConfirm();
	const selectedId = useEditorStore((state) => state.historyVersionId);
	const title = getVersionTitle(version);
	const failed = (error: unknown) => toast.add({ type: "error", description: source.errorMessage(error) });

	const rename = async () => {
		const name = (
			await prompt(t`Rename version`, { defaultValue: version.name ?? "", confirmText: t`Rename` })
		)?.trim();
		if (!name || name === version.name) return;
		await source.rename(version.id, name).catch(failed);
	};

	const remove = async () => {
		const confirmed = await confirm(t`Delete “${title}”?`, {
			description: t`Named versions are kept until you delete them. This can't be undone.`,
			confirmText: t`Delete version`,
			variant: "danger",
		});
		if (!confirmed) return;
		try {
			await source.remove(version.id);
			if (selectedId === version.id) useEditorStore.setState({ historyVersionId: null });
			toast.add({ description: t`Deleted “${title}”` });
		} catch (error) {
			failed(error);
		}
	};

	return (
		<DropdownMenu>
			<DropdownMenuTrigger
				render={
					<IconButton
						icon="dots-three"
						label={t`Rename or delete ${title}`}
						size="icon-sm"
						className="text-ink-2 opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100 data-popup-open:opacity-100 pointer-coarse:opacity-100"
					/>
				}
			/>
			<DropdownMenuContent align="end" className="w-44">
				<DropdownMenuItem onClick={() => void rename()}>
					<Icon name="pencil-simple" />
					<Trans>Rename…</Trans>
				</DropdownMenuItem>
				<DropdownMenuItem variant="destructive" onClick={() => void remove()}>
					<Icon name="trash" />
					<Trans>Delete</Trans>
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
