import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Button } from "@reactive-resume/ui/components/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@reactive-resume/ui/components/dropdown-menu";
import { Icon } from "@reactive-resume/ui/components/icon";
import { IconButton } from "@reactive-resume/ui/components/icon-button";
import { Spinner } from "@reactive-resume/ui/components/spinner";
import { TabsList, TabsTrigger } from "@reactive-resume/ui/components/tabs";
import { toast } from "@reactive-resume/ui/components/toast";
import { useBreakpoint } from "@reactive-resume/ui/hooks/use-breakpoint";
import { downloadWithAnchor } from "@reactive-resume/utils/file";
import { cn } from "@reactive-resume/utils/style";
import { createLetterFile, letterFileName } from "@/features/letters/export";
import { useLetterEditorStore } from "@/features/letters/store";
import { DocumentMenuTrigger } from "@/features/resume/editor/chrome";
import { DownloadButtons, EditorBarFrame } from "@/features/resume/editor/chrome/bar";
import { useEditorStore } from "@/features/resume/editor/store";
import { usePrompt } from "@/hooks/use-confirm";
import { getOrpcErrorMessage, getReadableErrorMessage } from "@/libs/error-message";
import { ENTER_CLASS } from "@/libs/motion";
import { client, orpc } from "@/libs/orpc/client";

type LetterBarProps = {
	layout: "desktop" | "tablet" | "mobile";
	/** Tablet in landscape: the panel can be pinned beside the page. */
	pinnable: boolean;
};

/**
 * The 56px bar: back, the letter's name and save state · Write/Design · History, Share and Download PDF. The mode
 * switch stays centered through a `1fr auto 1fr` grid.
 */
export function LetterBar({ layout, pinnable }: LetterBarProps) {
	const setShareTab = useEditorStore((state) => state.setShareTab);
	// Below 1280 the bar is too narrow for Share's label next to everything else.
	const wide = useBreakpoint() === "wide";
	const download = useDownloadLetter();

	return (
		<EditorBarFrame
			layout={layout}
			pinnable={pinnable}
			menu={<LetterMenu />}
			modes={
				<TabsList aria-label={t`Editor mode`} className="h-9" data-mode-switch="">
					<TabsTrigger value="write" className="px-4">
						<Icon name="pencil-simple" size={18} />
						<Trans>Write</Trans>
					</TabsTrigger>
					<TabsTrigger value="design" className="px-4">
						<Icon name="palette" size={18} />
						<Trans>Design</Trans>
					</TabsTrigger>
				</TabsList>
			}
		>
			{layout === "desktop" && wide ? (
				<Button variant="secondary" className="gap-1.5" onClick={() => setShareTab("download")}>
					<Icon name="export" />
					<Trans>Share</Trans>
				</Button>
			) : (
				<IconButton icon="export" label={t`Share`} onClick={() => setShareTab("download")} />
			)}
			<DownloadButtons
				busy={download.busy}
				onDownload={() => void download.run()}
				compact={layout === "mobile"}
				iconOnly={layout === "tablet"}
			/>
		</EditorBarFrame>
	);
}

/** Download PDF: the letter as it prints, with the sender's header, named First-Last-Cover-Letter.pdf. */
export function useDownloadLetter() {
	const [busy, setBusy] = useState(false);

	const run = async () => {
		const letter = useLetterEditorStore.getState().letter;
		if (!letter || busy) return;
		setBusy(true);
		const toastId = toast.add({ type: "loading", description: t`Generating PDF…` });
		try {
			const blob = await createLetterFile(letter, "pdf");
			downloadWithAnchor(blob, `${letterFileName(letter)}.pdf`);
		} catch (error) {
			toast.add({
				type: "error",
				description: getReadableErrorMessage(error, t`Couldn't generate the PDF. Try again.`),
			});
		}
		setBusy(false);
		toast.close(toastId);
	};

	return { run, busy };
}

const failed = (error: unknown) =>
	toast.add({
		type: "error",
		description: getOrpcErrorMessage(error, { fallback: t`Couldn't update the letter. Try again.` }),
	});

/** The name opens the letter's menu: rename, duplicate, lock and Move to Trash. The save state sits under it. */
function LetterMenu() {
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const prompt = usePrompt();
	const id = useLetterEditorStore((state) => state.letter?.id ?? "");
	const name = useLetterEditorStore((state) => state.letter?.name ?? "");
	const isLocked = useLetterEditorStore((state) => state.letter?.isLocked ?? false);
	const ref = { type: "letter" as const, id };

	const rename = async () => {
		const next = await prompt(t`Rename letter`, { defaultValue: name });
		const trimmed = next?.trim().slice(0, 100);
		if (trimmed && trimmed !== name) useLetterEditorStore.getState().edit({ name: trimmed });
	};

	const duplicate = async () => {
		try {
			if (!(await useLetterEditorStore.getState().flush()))
				throw new Error(t`Couldn't save your changes. Try again before continuing.`);
			const copy = await client.coverLetters.duplicate({ id });
			void queryClient.invalidateQueries({ queryKey: orpc.documents.key() });
			toast.add({ description: t`Letter duplicated` });
			void navigate({ to: "/builder/letter/$coverLetterId", params: { coverLetterId: copy.id } });
		} catch (error) {
			failed(error);
		}
	};

	// Locking moves the letter's revision on, so the letter is read again afterwards.
	const setLocked = (locked: boolean) =>
		useLetterEditorStore
			.getState()
			.change(async () => {
				await client.documents.setLocked({ ...ref, isLocked: locked });
				return client.coverLetters.getById({ id });
			})
			.catch(failed);

	// Undoable, so it doesn't ask first: the letter waits in Trash for 30 days.
	const trash = async () => {
		try {
			if (!(await useLetterEditorStore.getState().flush()))
				throw new Error(t`Couldn't save your changes. Try again before continuing.`);
			await client.documents.trash(ref);
			void queryClient.invalidateQueries({ queryKey: orpc.documents.key() });
			void navigate({ to: "/dashboard" });
			toast.add({
				description: t`“${name}” moved to Trash`,
				actionProps: {
					children: t`Undo`,
					onClick: () =>
						void client.documents
							.restore(ref)
							.then(() => queryClient.invalidateQueries({ queryKey: orpc.documents.key() }))
							.catch(failed),
				},
			});
		} catch (error) {
			failed(error);
		}
	};

	return (
		<>
			<DropdownMenu>
				<DropdownMenuTrigger render={<DocumentMenuTrigger name={name} isLocked={isLocked} />} />
				<DropdownMenuContent align="start" className="w-60">
					<DropdownMenuItem disabled={isLocked} onClick={() => void rename()}>
						<Icon name="pencil-simple" />
						<Trans>Rename…</Trans>
					</DropdownMenuItem>
					<DropdownMenuItem onClick={() => void duplicate()}>
						<Icon name="copy" />
						<Trans>Duplicate</Trans>
					</DropdownMenuItem>
					<DropdownMenuItem onClick={() => void setLocked(!isLocked)}>
						<Icon name={isLocked ? "lock-open" : "lock"} />
						{isLocked ? <Trans>Unlock editing</Trans> : <Trans>Lock editing</Trans>}
					</DropdownMenuItem>
					<DropdownMenuSeparator />
					<DropdownMenuItem variant="destructive" disabled={isLocked} onClick={() => void trash()}>
						<Icon name="trash" />
						<Trans>Move to Trash</Trans>
					</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>
			<LetterSaveStatus />
		</>
	);
}

/** Saved, Saving…, Not saved · Retry, or Changed elsewhere · Reload (after which the letter reads as saved). */
function LetterSaveStatus() {
	const status = useLetterEditorStore((state) => state.status);
	const id = useLetterEditorStore((state) => state.letter?.id ?? "");

	const reload = async () => {
		try {
			useLetterEditorStore.getState().load(await client.coverLetters.getById({ id }));
		} catch (error) {
			failed(error);
		}
	};

	return (
		<span role="status" aria-live="polite" className="flex min-w-0 items-center gap-1.5 text-xs leading-4 text-ink-3">
			{status === "saving" && (
				<>
					<Spinner decorative className="size-3" />
					<Trans>Saving…</Trans>
				</>
			)}
			{status === "saved" && (
				<>
					<Icon name="cloud-check" size={16} />
					<Trans>Saved</Trans>
				</>
			)}
			{status === "error" && (
				<span className={cn(ENTER_CLASS, "flex min-w-0 items-center gap-1.5 text-danger-text")}>
					<Icon name="cloud-warning" size={16} />
					<Trans>Not saved</Trans>
					<span aria-hidden="true">·</span>
					<button
						type="button"
						onClick={() => void useLetterEditorStore.getState().flush()}
						aria-label={t`Retry saving`}
						className="rounded-sm font-semibold underline underline-offset-2 hover:opacity-80"
					>
						<Trans>Retry</Trans>
					</button>
				</span>
			)}
			{status === "conflict" && (
				<span className={cn(ENTER_CLASS, "flex min-w-0 items-center gap-1.5 text-warn-text")}>
					<Icon name="cloud-warning" size={16} />
					<span className="truncate">
						<Trans>Changed elsewhere</Trans>
					</span>
					<span aria-hidden="true">·</span>
					<button
						type="button"
						onClick={() => void reload()}
						className="rounded-sm font-semibold underline underline-offset-2 hover:opacity-80"
					>
						<Trans>Reload</Trans>
					</button>
				</span>
			)}
		</span>
	);
}
