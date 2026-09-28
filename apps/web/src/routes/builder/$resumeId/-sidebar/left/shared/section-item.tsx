import type {
	CustomSectionItem,
	CustomSectionType,
	ResumeData,
	SectionItem as SectionItemType,
	SectionType,
} from "@reactive-resume/schema/resume/data";
import type { ButtonProps } from "@reactive-resume/ui/components/button";
import type { Ref } from "react";
import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import {
	ArrowBendUpRightIcon,
	CopySimpleIcon,
	DotsSixVerticalIcon,
	DotsThreeVerticalIcon,
	EyeClosedIcon,
	EyeIcon,
	FileIcon,
	FolderPlusIcon,
	PencilSimpleLineIcon,
	PlusCircleIcon,
	PlusIcon,
	TrashSimpleIcon,
} from "@phosphor-icons/react";
import { Reorder, useDragControls } from "motion/react";
import { useMemo } from "react";
import { Button } from "@reactive-resume/ui/components/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuSub,
	DropdownMenuSubContent,
	DropdownMenuSubTrigger,
	DropdownMenuTrigger,
} from "@reactive-resume/ui/components/dropdown-menu";
import { cn } from "@reactive-resume/utils/style";
import { useDialogStore } from "@/dialogs/store";
import { useCurrentResume, useUpdateResumeData } from "@/features/resume/builder/draft";
import { useConfirm } from "@/hooks/use-confirm";
import { EASE_OUT_STRONG } from "@/libs/motion";
import { atsFindingItemElementId } from "@/libs/resume/ats";
import { getCompatibleMoveTargets, getSourceSectionTitle, moveItem } from "@/libs/resume/move-item";

// ============================================================================
// MoveItemSubmenu Component
// ============================================================================

type MoveItemSubmenuProps = {
	type: CustomSectionType;
	item: CustomSectionItem | SectionItemType;
	customSectionId?: string;
};

/**
 * Submenu component for moving items between sections/pages.
 * Displays compatible targets grouped by page with options to:
 * - Move to existing compatible section
 * - Create new section on existing page
 * - Create new page with new section
 */
function MoveItemSubmenu({ type, item, customSectionId }: MoveItemSubmenuProps) {
	const resume = useCurrentResume();
	const updateResumeData = useUpdateResumeData();

	/** Compute compatible move targets grouped by page */
	const moveTargets = useMemo(
		() => getCompatibleMoveTargets(resume.data, type, customSectionId),
		[resume, type, customSectionId],
	);

	/** Get the current section's title (used when creating new sections) */
	const currentSectionTitle = useMemo(
		() => getSourceSectionTitle(resume.data, type, customSectionId),
		[resume, type, customSectionId],
	);

	/** Handler: Move item to an existing section */
	const handleMoveToSection = (targetSectionId: string) => {
		updateResumeData((draft) => {
			moveItem(draft, {
				itemId: item.id,
				type,
				customSectionId,
				target: { type: "section", sectionId: targetSectionId },
			});
		});
	};

	/** Handler: Create a new custom section on an existing page and move the item there */
	const handleNewSectionOnPage = (pageIndex: number) => {
		updateResumeData((draft) => {
			moveItem(draft, {
				itemId: item.id,
				type,
				customSectionId,
				target: { type: "new-section", title: currentSectionTitle, pageIndex },
			});
		});
	};

	/** Handler: Create a new page with a new custom section and move the item there */
	const handleNewPage = () => {
		updateResumeData((draft) => {
			moveItem(draft, {
				itemId: item.id,
				type,
				customSectionId,
				target: { type: "new-page", title: currentSectionTitle },
			});
		});
	};

	return (
		<DropdownMenuSub>
			<DropdownMenuSubTrigger>
				<ArrowBendUpRightIcon />
				<Trans>Move to</Trans>
			</DropdownMenuSubTrigger>

			<DropdownMenuSubContent>
				{/* Render each page as a submenu */}
				{moveTargets.map(({ pageIndex, sections }) => (
					<DropdownMenuSub key={pageIndex}>
						<DropdownMenuSubTrigger>
							<FileIcon />
							<Trans>Page {pageIndex + 1}</Trans>
						</DropdownMenuSubTrigger>

						<DropdownMenuSubContent>
							{/* Existing compatible sections on this page */}
							{sections.map(({ sectionId, sectionTitle }) => (
								<DropdownMenuItem key={sectionId} onClick={() => handleMoveToSection(sectionId)}>
									{sectionTitle}
								</DropdownMenuItem>
							))}

							{/* Separator if there are existing sections */}
							{sections.length > 0 && <DropdownMenuSeparator />}

							{/* Option to create a new section on this page */}
							<DropdownMenuItem onClick={() => handleNewSectionOnPage(pageIndex)}>
								<FolderPlusIcon />
								<Trans>New Section</Trans>
							</DropdownMenuItem>
						</DropdownMenuSubContent>
					</DropdownMenuSub>
				))}

				<DropdownMenuSeparator />

				{/* Option to create a new page with a new section */}
				<DropdownMenuItem onClick={handleNewPage}>
					<PlusCircleIcon />
					<Trans>New Page</Trans>
				</DropdownMenuItem>
			</DropdownMenuSubContent>
		</DropdownMenuSub>
	);
}

// ============================================================================
// SectionItem Component
// ============================================================================

type Props<T extends CustomSectionItem | SectionItemType> = {
	type: CustomSectionType;
	item: T;
	title: string;
	subtitle?: string;
	customSectionId?: string;
	// Injected by `AnimatePresence mode="popLayout"` to pop an exiting row out of the flow.
	ref?: Ref<HTMLLIElement>;
};

export function SectionItem<T extends CustomSectionItem | SectionItemType>({
	type,
	item,
	title,
	subtitle,
	customSectionId,
	ref,
}: Props<T>) {
	const confirm = useConfirm();
	const controls = useDragControls();
	const { openDialog } = useDialogStore();
	const updateResumeData = useUpdateResumeData();

	// Returns the items array (and index) this row lives in, from either a custom or a built-in section.
	const findItem = (draft: ResumeData) => {
		const items = customSectionId
			? draft.customSections.find((section) => section.id === customSectionId)?.items
			: // Type assertion: when customSectionId is not provided, type is always a built-in SectionType
				draft.sections[type as SectionType].items;
		const index = items?.findIndex((_item) => _item.id === item.id) ?? -1;
		return index === -1 || !items ? null : { items, index };
	};

	const onToggleVisibility = () => {
		updateResumeData((draft) => {
			const found = findItem(draft);
			if (found) found.items[found.index].hidden = !found.items[found.index].hidden;
		});
	};

	const onUpdate = () => {
		// Type assertion needed because TypeScript can't narrow the union type through template literals
		openDialog(`resume.sections.${type}.update`, { item, customSectionId } as never);
	};

	const onDuplicate = () => {
		// Type assertion needed because TypeScript can't narrow the union type through template literals
		openDialog(`resume.sections.${type}.create`, { item, customSectionId } as never);
	};

	const onDelete = async () => {
		const confirmed = await confirm(t`Are you sure you want to delete this item?`, {
			confirmText: t({
				comment: "Destructive confirmation button label when deleting a section item in resume builder",
				message: "Delete",
			}),
			cancelText: t({
				comment: "Confirmation dialog button label to abort deleting a section item in resume builder",
				message: "Cancel",
			}),
		});

		if (!confirmed) return;

		updateResumeData((draft) => {
			const found = findItem(draft);
			if (found) found.items.splice(found.index, 1);
		});
	};

	return (
		<Reorder.Item
			ref={ref}
			id={atsFindingItemElementId(item.id)}
			value={item}
			dragListener={false}
			dragControls={controls}
			initial={{ opacity: 0 }}
			animate={{ opacity: 1 }}
			exit={{ opacity: 0 }}
			transition={{ duration: 0.12, ease: EASE_OUT_STRONG }}
			whileDrag={{ boxShadow: "0 4px 12px rgb(0 0 0 / 0.08)" }}
			className="group relative flex h-18 select-none border-b bg-background"
		>
			<div
				className="flex cursor-grab touch-none items-center px-1.5 opacity-40 transition-[background-color,opacity] hover:bg-secondary/40 active:cursor-grabbing group-hover:opacity-100"
				onPointerDown={(e) => {
					e.preventDefault();
					controls.start(e);
				}}
			>
				<DotsSixVerticalIcon />
			</div>

			<button
				type="button"
				onClick={onUpdate}
				className={cn(
					"flex flex-1 flex-col items-start justify-center space-y-0.5 ps-1.5 text-start opacity-100 transition-opacity hover:bg-secondary/40 focus:outline-none focus-visible:ring-1",
					item.hidden && "opacity-50",
				)}
			>
				<div className="line-clamp-1 font-medium">{title}</div>
				{subtitle && <div className="line-clamp-1 text-muted-foreground text-xs">{subtitle}</div>}
			</button>

			<DropdownMenu>
				<DropdownMenuTrigger
					aria-label={t`Options for ${title}`}
					className="flex cursor-context-menu items-center px-1.5 opacity-40 transition-[background-color,opacity] hover:bg-secondary/40 focus:outline-none focus-visible:ring-1 group-hover:opacity-100"
				>
					<DotsThreeVerticalIcon />
				</DropdownMenuTrigger>

				<DropdownMenuContent align="end">
					<DropdownMenuGroup>
						<DropdownMenuItem onClick={onToggleVisibility}>
							{item.hidden ? <EyeIcon /> : <EyeClosedIcon />}
							{item.hidden ? <Trans>Show</Trans> : <Trans>Hide</Trans>}
						</DropdownMenuItem>
					</DropdownMenuGroup>

					<DropdownMenuSeparator />

					<DropdownMenuGroup>
						<DropdownMenuItem onClick={onUpdate}>
							<PencilSimpleLineIcon />
							<Trans>Update</Trans>
						</DropdownMenuItem>

						<DropdownMenuItem onClick={onDuplicate}>
							<CopySimpleIcon />
							<Trans>Duplicate</Trans>
						</DropdownMenuItem>

						<MoveItemSubmenu type={type} item={item} customSectionId={customSectionId} />
					</DropdownMenuGroup>

					<DropdownMenuSeparator />

					<DropdownMenuGroup>
						<DropdownMenuItem variant="destructive" onClick={onDelete}>
							<TrashSimpleIcon />
							<Trans>Delete</Trans>
						</DropdownMenuItem>
					</DropdownMenuGroup>
				</DropdownMenuContent>
			</DropdownMenu>
		</Reorder.Item>
	);
}

type AddButtonProps = Omit<ButtonProps, "type"> & {
	type: CustomSectionType | "custom";
	customSectionId?: string;
};

export function SectionAddItemButton({ type, customSectionId, className, children, ...props }: AddButtonProps) {
	const { openDialog } = useDialogStore();

	const handleAdd = () => {
		if (type === "custom") {
			openDialog("resume.sections.custom.create", undefined);
		} else {
			openDialog(`resume.sections.${type}.create`, customSectionId ? { customSectionId } : undefined);
		}
	};

	return (
		<Button
			variant="ghost"
			onClick={handleAdd}
			className={cn("h-12 w-full justify-start rounded-t-none", className)}
			{...props}
		>
			<PlusIcon />
			{children}
		</Button>
	);
}
