import type { Icon } from "@phosphor-icons/react";
import type { BuilderPreviewPageLayout } from "./page-layout";
import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import {
	AlignCenterHorizontalIcon,
	AlignTopIcon,
	ArrowUUpLeftIcon,
	ArrowUUpRightIcon,
	ChatCircleDotsIcon,
	LinkSimpleIcon,
	MagnifyingGlassMinusIcon,
	MagnifyingGlassPlusIcon,
} from "@phosphor-icons/react";
import { useHotkey } from "@tanstack/react-hotkeys";
import { useNavigate } from "@tanstack/react-router";
import { m, useReducedMotion } from "motion/react";
import { useControls, useTransformComponent } from "react-zoom-pan-pinch";
import { useCopyToClipboard } from "usehooks-ts";
import { Button } from "@reactive-resume/ui/components/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@reactive-resume/ui/components/dropdown-menu";
import { toast } from "@reactive-resume/ui/components/toast";
import { Tooltip, TooltipContent, TooltipTrigger } from "@reactive-resume/ui/components/tooltip";
import {
	isEditableElementFocused,
	useCurrentBuilderResumeSelector,
	useResumeStore,
} from "@/features/resume/builder/draft";
import { authClient } from "@/libs/auth/client";
import { EASE_OUT_STRONG } from "@/libs/motion";

type BuilderDockProps = {
	pageLayout: BuilderPreviewPageLayout;
	onTogglePageLayout: () => void;
};

export function BuilderDock({ pageLayout, onTogglePageLayout }: BuilderDockProps) {
	const { data: session } = authClient.useSession();
	// Narrow slices: selecting the whole resume re-renders the dock on every keystroke.
	const resumeSlug = useCurrentBuilderResumeSelector((resume) => resume.slug);
	const resumeId = useCurrentBuilderResumeSelector((resume) => resume.id);
	const navigate = useNavigate();

	const [_, copyToClipboard] = useCopyToClipboard();
	const { zoomIn, zoomOut, resetTransform } = useControls();
	const zoomDuration = useReducedMotion() ? 0 : 150;

	const canUndo = useResumeStore((state) => state.canUndo);
	const canRedo = useResumeStore((state) => state.canRedo);
	const undo = useResumeStore((state) => state.undo);
	const redo = useResumeStore((state) => state.redo);

	// Keyboard actions snap instantly; animating a shortcut makes it feel sluggish.
	useHotkey("Mod+0", () => resetTransform(0));
	// App-level undo/redo of resume state, scoped to the builder. Mod maps to Cmd (mac) / Ctrl (win/linux).
	// Inside a focused text field, defer to the browser's native input undo; the dock buttons remain
	// available for resume-level history while editing a field.
	useHotkey("Mod+Z", () => {
		if (isEditableElementFocused()) return;
		undo();
	});
	useHotkey("Mod+Shift+Z", () => {
		if (isEditableElementFocused()) return;
		redo();
	});
	useHotkey("Control+Y", () => {
		if (isEditableElementFocused()) return;
		redo();
	});

	const publicUrl =
		session?.user.username && resumeSlug ? `${window.location.origin}/${session.user.username}/${resumeSlug}` : "";

	return (
		<div className="fixed inset-x-0 bottom-20 flex items-center justify-center md:bottom-4">
			<m.div
				initial={{ opacity: 0, transform: "translateY(8px)" }}
				animate={{ opacity: 1, transform: "translateY(0px)" }}
				transition={{ duration: 0.2, ease: EASE_OUT_STRONG }}
				className="flex items-center rounded-r-full rounded-l-full bg-popover px-2 shadow-xl"
			>
				<DockIcon icon={ArrowUUpLeftIcon} title={t`Undo`} disabled={!canUndo} onClick={() => undo()} />
				<DockIcon icon={ArrowUUpRightIcon} title={t`Redo`} disabled={!canRedo} onClick={() => redo()} />
				<div className="mx-1 h-8 w-px bg-border" />
				<DockIcon
					icon={MagnifyingGlassMinusIcon}
					title={t`Zoom out`}
					onClick={() => zoomOut(0.15, zoomDuration, "easeOutCubic")}
				/>
				<ZoomMenu />
				<DockIcon
					icon={MagnifyingGlassPlusIcon}
					title={t`Zoom in`}
					onClick={() => zoomIn(0.15, zoomDuration, "easeOutCubic")}
				/>
				<DockIcon
					icon={pageLayout === "horizontal" ? AlignTopIcon : AlignCenterHorizontalIcon}
					title={t`Toggle page stacking`}
					onClick={onTogglePageLayout}
				/>
				<DockIcon
					icon={ChatCircleDotsIcon}
					title={t`Open AI agent`}
					onClick={() => {
						if (!resumeId) return;
						void navigate({ to: "/agent/new", search: { resumeId } });
					}}
				/>
				<div className="mx-1 h-8 w-px bg-border" />
				<DockIcon
					icon={LinkSimpleIcon}
					title={t`Copy URL`}
					onClick={async () => {
						await copyToClipboard(publicUrl);
						toast.add({ type: "success", description: t`Resume link copied to clipboard.` });
					}}
				/>
			</m.div>
		</div>
	);
}

function ZoomMenu() {
	const scale = useTransformComponent((ctx) => ctx.state.scale);
	const { centerView, resetTransform } = useControls();
	const zoomDuration = useReducedMotion() ? 0 : 200;

	return (
		<DropdownMenu>
			<DropdownMenuTrigger
				render={
					<Button
						size="sm"
						variant="ghost"
						aria-label={t`Zoom level`}
						className="h-8 min-w-14 px-2 font-medium text-xs tabular-nums"
					>
						{Math.round(scale * 100)}%
					</Button>
				}
			/>

			<DropdownMenuContent side="top" align="center">
				<DropdownMenuItem onClick={() => centerView(1, zoomDuration, "easeOutCubic")}>
					<Trans>Actual size (100%)</Trans>
				</DropdownMenuItem>
				<DropdownMenuItem onClick={() => resetTransform(zoomDuration, "easeOutCubic")}>
					<Trans>Fit to view</Trans>
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

type DockIconProps = {
	title: string;
	icon: Icon;
	disabled?: boolean;
	onClick: () => void;
};

function DockIcon({ icon: Icon, title, disabled, onClick }: DockIconProps) {
	return (
		<Tooltip>
			{/* A disabled button ignores the pointer, so a wrapper keeps the tooltip working for Undo/Redo. */}
			<TooltipTrigger render={<span className="inline-flex" />}>
				<Button size="icon" variant="ghost" disabled={disabled} onClick={onClick} aria-label={title}>
					<Icon className="size-4" />
				</Button>
			</TooltipTrigger>

			<TooltipContent side="top" align="center" className="font-medium">
				{title}
			</TooltipContent>
		</Tooltip>
	);
}
