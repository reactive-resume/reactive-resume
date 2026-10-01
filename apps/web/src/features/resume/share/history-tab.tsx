import type { VersionSummary } from "./format";
import type { Resume } from "@/features/resume/builder/draft";
import { t } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import { Trans } from "@lingui/react/macro";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
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
import { savePendingChanges, useCurrentResume, useResumeStore } from "@/features/resume/builder/draft";
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
};

/** History for the resume in the editor. */
export function HistoryTab() {
	return <HistoryTimeline source={useResumeHistory()} />;
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
			const restored = await orpc.resume.restoreVersion.call({ resumeId: resume.id, versionId });
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
	const setVersion = useEditorStore((state) => state.setHistoryVersion);
	const [name, setName] = useState("");
	const [busy, setBusy] = useState(false);
	const { versions, loading } = source;

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
			setVersion(null);
			toast.add({
				description: t`Restored the version from ${formatVersionMoment(version.createdAt, i18n.locale)}. Your previous state is saved as “Before restore”.`,
			});
		});

	return (
		<div className="grid gap-3.5">
			<form
				className="flex gap-1.5"
				onSubmit={(event) => {
					event.preventDefault();
					save();
				}}
			>
				<Input
					value={name}
					maxLength={80}
					aria-label={t`Name this version`}
					placeholder={t`Name this version, e.g. Sent to Lumen`}
					onChange={(event) => setName(event.target.value)}
					className="h-9"
				/>
				<Button type="submit" variant="secondary" disabled={!name.trim() || busy}>
					<Trans>Save</Trans>
				</Button>
			</form>

			{selected && (
				<div role="status" className="grid gap-2.5 rounded-[10px] bg-ink p-3 text-[13px] text-bg">
					<span className="flex items-center gap-2 font-medium">
						<Icon name="history" size={18} />
						<Trans>
							Viewing {when(selected)} · {getVersionTitle(selected)} · read-only
						</Trans>
					</span>
					<span className="flex flex-wrap gap-2">
						<Button size="sm" disabled={source.locked || busy} onClick={() => restore(selected)}>
							<Trans>Restore this version</Trans>
						</Button>
						<Button
							size="sm"
							variant="ghost"
							className="text-bg underline underline-offset-[3px] hover:bg-transparent hover:text-bg"
							onClick={() => setVersion(null)}
						>
							<Trans>Back to now</Trans>
						</Button>
					</span>
				</div>
			)}

			<ol className="grid" aria-label={t`Versions`}>
				<TimelineItem
					title={t`Now`}
					detail={source.nowDetail}
					selected={!selected}
					current
					last={!versions?.length}
					onSelect={() => setVersion(null)}
				/>
				{versions?.map((version, index) => (
					<TimelineItem
						key={version.id}
						title={getVersionTitle(version)}
						detail={`${when(version)} · ${getVersionDetail(version)}`}
						named={version.kind === "named"}
						selected={version.id === selectedId}
						last={index === versions.length - 1}
						onSelect={() => setVersion(version.id)}
						menu={version.kind === "named" ? <NamedVersionMenu version={version} source={source} /> : null}
					/>
				))}
			</ol>

			{!loading && (versions?.length ?? 0) <= 1 && (
				<p className="text-[13px] leading-[19px] text-ink-2">
					<Trans>Only one version so far. Every editing session adds one automatically.</Trans>
				</p>
			)}

			<p className="text-xs leading-[17px] text-ink-3">
				<Trans>
					Autosaves are grouped by session and kept for 90 days. Named versions are kept until you delete them.
					Restoring saves the current state first.
				</Trans>
			</p>
		</div>
	);
}

type TimelineItemProps = {
	title: string;
	detail: string;
	selected: boolean;
	last: boolean;
	onSelect: () => void;
	current?: boolean;
	named?: boolean;
	menu?: React.ReactNode;
};

function TimelineItem({ title, detail, selected, last, onSelect, current, named, menu }: TimelineItemProps) {
	return (
		<li className="grid grid-cols-[20px_minmax(0,1fr)] gap-2.5">
			<span aria-hidden="true" className="flex flex-col items-center">
				<span
					className={cn(
						"mt-[15px] size-2.5 shrink-0 rounded-full shadow-[0_0_0_3px_var(--raised)]",
						current ? "bg-accent" : selected ? "bg-ink" : "bg-line-2",
					)}
				/>
				{!last && <span className="w-[1.5px] flex-1 bg-line" />}
			</span>
			<span
				className={cn(
					"group/version my-0.5 flex items-start rounded-[10px] border transition-colors duration-quick",
					selected ? "border-line-2 bg-sunken" : "border-transparent hover:bg-hover",
				)}
			>
				<button
					type="button"
					aria-pressed={selected}
					onClick={onSelect}
					className="flex min-w-0 flex-1 flex-col items-start gap-0.5 px-2.5 py-[9px] text-start"
				>
					<span className="flex max-w-full items-center gap-2">
						<span className="truncate text-[13px] font-semibold">{title}</span>
						{named && <Icon name="bookmark" size={14} className="text-accent-text" />}
					</span>
					<span className="text-xs text-ink-3">{detail}</span>
				</button>
				{menu && <span className="p-1">{menu}</span>}
			</span>
		</li>
	);
}

/** Named versions are the user's own: they can be renamed or deleted. The rest expire on their own. */
function NamedVersionMenu({ version, source }: { version: HistoryVersion; source: HistorySource }) {
	const prompt = usePrompt();
	const confirm = useConfirm();
	const selectedId = useEditorStore((state) => state.historyVersionId);
	const setVersion = useEditorStore((state) => state.setHistoryVersion);
	const title = getVersionTitle(version);
	const failed = (error: unknown) => toast.add({ type: "error", description: source.errorMessage(error) });

	const rename = async () => {
		const name = (await prompt(t`Rename version`, { defaultValue: version.name ?? "" }))?.trim();
		if (!name || name === version.name) return;
		await source.rename(version.id, name).catch(failed);
	};

	const remove = async () => {
		const confirmed = await confirm(t`Delete “${title}”?`, {
			description: t`Named versions are kept until you delete them. This can't be undone.`,
			confirmText: t`Delete`,
		});
		if (!confirmed) return;
		try {
			await source.remove(version.id);
			if (selectedId === version.id) setVersion(null);
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
						icon="more_horiz"
						label={t`Options for ${title}`}
						size="icon-sm"
						className="text-ink-2 opacity-0 group-hover/version:opacity-100 focus-visible:opacity-100 data-popup-open:opacity-100"
					/>
				}
			/>
			<DropdownMenuContent align="end" className="w-44">
				<DropdownMenuItem onClick={() => void rename()}>
					<Icon name="edit" />
					<Trans>Rename…</Trans>
				</DropdownMenuItem>
				<DropdownMenuItem variant="destructive" onClick={() => void remove()}>
					<Icon name="delete" />
					<Trans>Delete</Trans>
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
