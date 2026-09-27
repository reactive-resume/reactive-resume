import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import {
	CaretDownIcon,
	CheckCircleIcon,
	CircleNotchIcon,
	CopySimpleIcon,
	DownloadSimpleIcon,
	HouseSimpleIcon,
	LockSimpleIcon,
	LockSimpleOpenIcon,
	PencilSimpleLineIcon,
	SidebarSimpleIcon,
	TrashSimpleIcon,
	WarningCircleIcon,
} from "@phosphor-icons/react";
import { useMutation } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { match } from "ts-pattern";
import { Button } from "@reactive-resume/ui/components/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@reactive-resume/ui/components/dropdown-menu";
import { toast } from "@reactive-resume/ui/components/toast";
import { cn } from "@reactive-resume/utils/style";
import { useDialogStore } from "@/dialogs/store";
import {
	useCurrentBuilderResumeSelector,
	useCurrentResume,
	usePatchResume,
	useResumeStore,
} from "@/features/resume/builder/draft";
import { ResumeDownloadDialog } from "@/features/resume/export/download-dialog";
import { useConfirm } from "@/hooks/use-confirm";
import { getResumeErrorMessage } from "@/libs/error-message";
import { orpc } from "@/libs/orpc/client";
import { useBuilderSidebar } from "../-store/sidebar";
import { BuilderAiAssistant } from "./ai-assistant";
import { BuilderVersionHistory } from "./version-history";

export function BuilderHeader() {
	// Subscribe to only the metadata fields this header renders. Selecting the whole resume re-renders
	// the header on every keystroke (immer replaces the resume reference on each content edit).
	const name = useCurrentBuilderResumeSelector((resume) => resume.name);
	const isLocked = useCurrentBuilderResumeSelector((resume) => resume.isLocked);
	const resumeId = useCurrentBuilderResumeSelector((resume) => resume.id);
	const { toggleSidebar } = useBuilderSidebar();

	// Equal-width flex-1 side groups keep the center title group truly centered regardless of the
	// wider Download button on the right.
	return (
		<div className="absolute inset-x-0 top-0 z-50 flex h-14 min-w-0 items-center gap-x-2 border-b bg-popover px-1.5">
			<div className="flex min-w-0 flex-1 items-center justify-start">
				{/* Hidden below `md`: on mobile the sidebar panels never mount, so `toggleSidebar` no-ops — the bottom tab bar handles this. */}
				<Button size="icon" variant="ghost" className="hidden md:flex" onClick={() => toggleSidebar("left")}>
					<SidebarSimpleIcon />
					<span className="sr-only">
						<Trans comment="Screen-reader label for opening or closing the left sidebar in resume builder">
							Toggle left sidebar
						</Trans>
					</span>
				</Button>
			</div>

			<div className="flex min-w-0 items-center gap-x-1">
				<Button
					size="icon"
					variant="ghost"
					aria-label={t({
						comment: "Accessible label for button navigating from builder to resumes dashboard",
						message: "Go to resumes dashboard",
					})}
					nativeButton={false}
					render={
						<Link to="/dashboard/resumes" search={{ sort: "lastUpdatedAt", tags: [] }}>
							<HouseSimpleIcon />
						</Link>
					}
				/>
				<span className="me-2.5 text-muted-foreground">/</span>
				<h2 className="min-w-0 truncate font-medium">{name}</h2>
				{isLocked && <LockSimpleIcon className="ms-2 text-muted-foreground" />}
				<SaveStatusIndicator />
				<BuilderAiAssistant resumeId={resumeId} />
				<BuilderVersionHistory resumeId={resumeId} />
				<BuilderHeaderDropdown />
			</div>

			<div className="flex min-w-0 flex-1 items-center justify-end gap-x-1">
				<ResumeDownloadButton />

				<Button size="icon" variant="ghost" className="hidden md:flex" onClick={() => toggleSidebar("right")}>
					<SidebarSimpleIcon className="-scale-x-100" />
					<span className="sr-only">
						<Trans comment="Screen-reader label for opening or closing the right sidebar in resume builder">
							Toggle right sidebar
						</Trans>
					</span>
				</Button>
			</div>
		</div>
	);
}

function ResumeDownloadButton() {
	const resume = useCurrentResume();

	return (
		<ResumeDownloadDialog
			resume={resume}
			trigger={(disabled) => (
				<Button
					size="sm"
					aria-label={t({
						comment: "Primary action in the builder header to open resume download options",
						message: "Download options",
					})}
					disabled={disabled}
					className="px-2 sm:px-2.5"
				>
					{disabled ? (
						<CircleNotchIcon className="animate-spin sm:me-1.5" />
					) : (
						<DownloadSimpleIcon className="sm:me-1.5" />
					)}
					<span className="hidden sm:inline">
						<Trans comment="Primary action in the builder header to open resume download options">Download</Trans>
					</span>
				</Button>
			)}
		/>
	);
}

function SaveStatusIndicator() {
	const status = useResumeStore((state) => state.saveStatus);

	const { icon, label } = match(status)
		.with("idle", () => ({ icon: null, label: "" }))
		.with("saving", () => ({
			icon: <CircleNotchIcon className="animate-spin" />,
			label: t`Saving…`,
		}))
		.with("saved", () => ({ icon: <CheckCircleIcon />, label: t`Saved` }))
		.with("error", () => ({
			icon: <WarningCircleIcon className="text-destructive" />,
			label: t`Couldn't save`,
		}))
		.exhaustive();

	return (
		<span
			// Always reserve the slot so the header buttons don't shift when the status appears or clears.
			className={cn(
				"ms-1 flex min-w-3 shrink-0 items-center gap-x-1 text-muted-foreground text-xs md:min-w-18",
				status === "idle" && "invisible",
			)}
			aria-live="polite"
			role="status"
		>
			{icon}
			<span className="hidden md:inline">{label}</span>
		</span>
	);
}

function BuilderHeaderDropdown() {
	const confirm = useConfirm();
	const navigate = useNavigate();
	const { openDialog } = useDialogStore();

	const resume = useCurrentResume();
	const patchResume = usePatchResume();
	const id = resume.id;
	const name = resume.name;
	const slug = resume.slug;
	const tags = resume.tags;
	const isLocked = resume.isLocked;

	const { mutate: deleteResume } = useMutation(orpc.resume.delete.mutationOptions());
	const { mutate: setLockedResume } = useMutation(orpc.resume.setLocked.mutationOptions());

	const handleUpdate = () => {
		openDialog("resume.update", { id, name, slug, tags });
	};

	const handleDuplicate = () => {
		openDialog("resume.duplicate", { id, name, slug, tags, shouldRedirect: true });
	};

	const handleToggleLock = async () => {
		if (!isLocked) {
			const confirmation = await confirm(t`Are you sure you want to lock this resume?`, {
				description: t`When locked, the resume cannot be updated or deleted.`,
			});

			if (!confirmation) return;
		}

		setLockedResume(
			{ id, isLocked: !isLocked },
			{
				onSuccess: () => {
					patchResume((draft) => {
						draft.isLocked = !isLocked;
					});
				},
				onError: (error) => {
					toast.add({ type: "error", description: getResumeErrorMessage(error) });
				},
			},
		);
	};

	const handleDelete = async () => {
		const confirmation = await confirm(t`Are you sure you want to delete this resume?`, {
			description: t`This action cannot be undone.`,
		});

		if (!confirmation) return;

		const toastId = toast.add({ type: "loading", description: t`Deleting your resume...` });

		deleteResume(
			{ id },
			{
				onSuccess: () => {
					toast.add({ type: "success", description: t`Your resume has been deleted.`, id: toastId });
					void navigate({ to: "/dashboard/resumes", search: { sort: "lastUpdatedAt", tags: [] } });
				},
				onError: (error) => {
					toast.add({ type: "error", description: getResumeErrorMessage(error), id: toastId });
				},
			},
		);
	};

	return (
		<DropdownMenu>
			<DropdownMenuTrigger
				render={
					<Button size="icon" variant="ghost" aria-label={t`Resume options`}>
						<CaretDownIcon />
					</Button>
				}
			/>

			<DropdownMenuContent>
				<DropdownMenuItem disabled={isLocked} onClick={handleUpdate}>
					<PencilSimpleLineIcon className="me-2" />
					<Trans>Edit details</Trans>
				</DropdownMenuItem>

				<DropdownMenuItem onClick={handleDuplicate}>
					<CopySimpleIcon className="me-2" />
					<Trans>Duplicate</Trans>
				</DropdownMenuItem>

				<DropdownMenuItem onClick={handleToggleLock}>
					{isLocked ? <LockSimpleOpenIcon className="me-2" /> : <LockSimpleIcon className="me-2" />}
					{isLocked ? <Trans>Unlock</Trans> : <Trans>Lock</Trans>}
				</DropdownMenuItem>

				<DropdownMenuSeparator />

				<DropdownMenuItem variant="destructive" disabled={isLocked} onClick={handleDelete}>
					<TrashSimpleIcon className="me-2" />
					<Trans>Delete</Trans>
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
