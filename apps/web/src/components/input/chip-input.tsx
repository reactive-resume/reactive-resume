import type { DragEndEvent, DragStartEvent } from "@dnd-kit/core";
import {
	closestCenter,
	DndContext,
	DragOverlay,
	KeyboardSensor,
	PointerSensor,
	useSensor,
	useSensors,
} from "@dnd-kit/core";
import { rectSortingStrategy, SortableContext, sortableKeyboardCoordinates, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useReducedMotion } from "motion/react";
import * as React from "react";
import { createPortal } from "react-dom";
import { Badge } from "@reactive-resume/ui/components/badge";
import { useFormControl } from "@reactive-resume/ui/components/form";
import { Icon } from "@reactive-resume/ui/components/icon";
import { Input } from "@reactive-resume/ui/components/input";
import { Kbd } from "@reactive-resume/ui/components/kbd";
import { cn } from "@reactive-resume/utils/style";
import { useControlledState } from "@/hooks/use-controlled-state";
import { isImeComposing } from "@/libs/keyboard";
import { DRAG_SETTLE } from "@/libs/motion";

const RETURN_KEY = "Enter";
const COMMA_KEY = ",";
const EMPTY_CHIPS: string[] = [];

type ChipItemProps = {
	id: string;
	chip: string;
	index: number;
	isEditing: boolean;
	onEdit: (index: number) => void;
	onRemove: (index: number) => void;
};

type ChipDragPreviewProps = {
	chip: string;
};

function ChipDragPreview({ chip }: ChipDragPreviewProps) {
	return (
		<Badge
			variant="outline"
			className="h-6 max-w-44 cursor-grabbing justify-start rounded-md border-accent bg-sunken px-2 text-xs font-medium text-ink shadow-lg ring-2 ring-accent/25 select-none sm:max-w-52"
		>
			<span className="truncate">{chip}</span>
		</Badge>
	);
}

type ChipDragOverlayProps = {
	activeChip: string | null;
};

function ChipDragOverlay({ activeChip }: ChipDragOverlayProps) {
	const reduceMotion = useReducedMotion();
	const overlay = (
		<DragOverlay dropAnimation={reduceMotion ? null : DRAG_SETTLE}>
			{activeChip ? <ChipDragPreview chip={activeChip} /> : null}
		</DragOverlay>
	);

	return createPortal(overlay, document.body);
}

function ChipItem({ id, chip, index, isEditing, onEdit, onRemove }: ChipItemProps) {
	const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
		id,
		transition: DRAG_SETTLE,
	});

	const style = {
		transition,
		zIndex: isDragging ? 10 : undefined,
		transform: CSS.Transform.toString(transform),
	};

	return (
		<div
			style={style}
			ref={setNodeRef}
			className={cn("group/chip relative touch-none", isDragging && "opacity-60")}
			{...attributes}
			{...listeners}
		>
			<Badge
				variant="outline"
				className={cn(
					"h-6 max-w-full cursor-grab justify-start gap-0 rounded-md border-line bg-sunken/55 px-2 text-xs font-medium text-ink transition-colors select-none hover:border-ink/20 hover:bg-sunken active:cursor-grabbing",
					isEditing && "border-accent bg-accent/10 ring-1 ring-accent/40",
					isDragging && "border-accent bg-sunken shadow-sm",
				)}
			>
				<span className="max-w-32 truncate sm:max-w-44">{chip}</span>
				<div
					className={cn(
						"ms-1.5 flex shrink-0 items-center gap-x-0.5 transition-opacity duration-quick group-focus-within/chip:opacity-100 group-hover/chip:opacity-100",
						isEditing ? "opacity-100" : "opacity-65",
					)}
				>
					<button
						type="button"
						tabIndex={-1}
						className="rounded-sm p-0.5 text-ink/70 transition-colors hover:bg-sunken hover:text-ink focus:outline-none"
						aria-label={t({
							comment:
								"Screen reader label for button that edits a keyword chip. Variable is the current keyword text.",
							message: `Edit ${chip}`,
						})}
						onClick={(e) => {
							e.stopPropagation();
							onEdit(index);
						}}
					>
						<Icon name="pencil-simple" size={14} />
					</button>
					<button
						type="button"
						tabIndex={-1}
						className="rounded-sm p-0.5 text-ink/70 transition-colors hover:bg-danger/10 hover:text-danger-text focus:outline-none"
						aria-label={t({
							comment:
								"Screen reader label for button that removes a keyword chip. Variable is the current keyword text.",
							message: `Remove ${chip}`,
						})}
						onClick={(e) => {
							e.stopPropagation();
							onRemove(index);
						}}
					>
						<Icon name="x" size={14} />
					</button>
				</div>
			</Badge>
		</div>
	);
}

type Props = Omit<React.ComponentProps<"div">, "value" | "onChange"> & {
	value?: string[];
	defaultValue?: string[];
	onChange?: (value: string[]) => void;
	hideDescription?: boolean;
	allowCommas?: boolean;
};

export function ChipInput({
	value,
	defaultValue = EMPTY_CHIPS,
	onChange,
	className,
	hideDescription = false,
	allowCommas = false,
	id: idProp,
	"aria-describedby": ariaDescribedByProp,
	"aria-invalid": ariaInvalidProp,
	...props
}: Props) {
	const formControl = useFormControl();
	const controlId = idProp ?? formControl.id;
	const describedBy = ariaDescribedByProp ?? formControl["aria-describedby"];
	const invalid = ariaInvalidProp ?? formControl["aria-invalid"];
	const labelId = formControl.labelId;

	const [chips, setChips] = useControlledState<string[]>({
		value,
		defaultValue,
		onChange,
	});

	const [input, setInput] = React.useState("");
	const [editingIndex, setEditingIndex] = React.useState<number | null>(null);
	const [activeChip, setActiveChip] = React.useState<string | null>(null);
	const inputRef = React.useRef<HTMLInputElement>(null);
	const dndContextId = React.useId();
	const isEditingKeyword = editingIndex !== null;
	const hasChips = chips.length > 0;

	const addChips = React.useCallback(
		(values: string[]) => {
			const nextValues = values.flatMap((chip) => {
				const trimmed = chip.trim();
				return trimmed ? [trimmed] : [];
			});
			if (nextValues.length === 0) return;

			const newChips = [...new Set([...chips, ...nextValues])];
			setChips(newChips);
		},
		[chips, setChips],
	);

	const addChip = React.useCallback(
		(chip: string) => {
			addChips([chip]);
		},
		[addChips],
	);

	const updateChip = React.useCallback(
		(index: number, newValue: string) => {
			const trimmed = newValue.trim();
			if (!trimmed || index < 0 || index >= chips.length) return;

			const existingIndex = chips.findIndex((c, i) => c === trimmed && i !== index);
			if (existingIndex !== -1) return;

			const newChips = [...chips];
			newChips[index] = trimmed;
			setChips(newChips);
		},
		[chips, setChips],
	);

	const removeChip = React.useCallback(
		(index: number) => {
			if (index < 0 || index >= chips.length) return;
			const newChips = chips.slice(0, index).concat(chips.slice(index + 1));
			setChips(newChips);

			if (editingIndex === index) {
				setEditingIndex(null);
				setInput("");
			} else if (editingIndex !== null && editingIndex > index) {
				setEditingIndex((current) => (current !== null && current > index ? current - 1 : current));
			}
		},
		[chips, setChips, editingIndex],
	);

	const handleEdit = React.useCallback(
		(index: number) => {
			const chip = chips[index];
			if (chip === undefined) return;
			setEditingIndex(index);
			setInput(chip);
			inputRef.current?.focus();
		},
		[chips],
	);

	const handleReorder = React.useCallback(
		(newOrder: string[]) => {
			if (editingIndex !== null) {
				const editingChip = chips[editingIndex];
				const newIndex = editingChip === undefined ? -1 : newOrder.indexOf(editingChip);
				if (newIndex !== -1 && newIndex !== editingIndex) {
					setEditingIndex(newIndex);
				}
			}
			setChips(newOrder);
		},
		[chips, editingIndex, setChips],
	);

	const sensors = useSensors(
		useSensor(PointerSensor, {
			activationConstraint: { distance: 3 },
		}),
		useSensor(KeyboardSensor, {
			coordinateGetter: sortableKeyboardCoordinates,
		}),
	);

	const handleDragStart = React.useCallback((event: DragStartEvent) => {
		setActiveChip(event.active.id as string);
	}, []);

	const handleDragCancel = React.useCallback(() => {
		setActiveChip(null);
	}, []);

	const handleDragEnd = React.useCallback(
		(event: DragEndEvent) => {
			setActiveChip(null);

			const { active, over } = event;
			if (!over || active.id === over.id) return;
			const oldIndex = chips.indexOf(active.id as string);
			const newIndex = chips.indexOf(over.id as string);
			if (oldIndex !== -1 && newIndex !== -1 && oldIndex !== newIndex) {
				const newOrder = [...chips];
				const [removed] = newOrder.splice(oldIndex, 1);
				if (removed === undefined) return;
				newOrder.splice(newIndex, 0, removed);
				handleReorder(newOrder);
			}
		},
		[chips, handleReorder],
	);

	const handleInputChange = React.useCallback(
		(e: React.ChangeEvent<HTMLInputElement>) => {
			const newValue = e.target.value;

			if (editingIndex !== null) {
				if (!allowCommas && newValue.includes(",")) {
					updateChip(editingIndex, newValue.replace(",", ""));
					setEditingIndex(null);
					setInput("");
				} else {
					setInput(newValue);
				}
				return;
			}

			if (!allowCommas && newValue.includes(",")) {
				const parts = newValue.split(",");
				addChips(parts.slice(0, -1));
				setInput(parts.at(-1) ?? "");
			} else {
				setInput(newValue);
			}
		},
		[addChips, allowCommas, editingIndex, updateChip],
	);

	const handleKeyDown = React.useCallback(
		(e: React.KeyboardEvent<HTMLInputElement>) => {
			if (isImeComposing(e)) return;
			if (e.key === "Enter" || (!allowCommas && e.key === ",")) {
				e.preventDefault();

				if (editingIndex !== null) {
					if (input.trim()) {
						updateChip(editingIndex, input);
					}
					setEditingIndex(null);
					setInput("");
				} else if (input.trim()) {
					addChip(input);
					setInput("");
				}
			} else if (e.key === "Escape" && editingIndex !== null) {
				setEditingIndex(null);
				setInput("");
			}
		},
		[input, addChip, allowCommas, editingIndex, updateChip],
	);

	return (
		<div className={cn("space-y-1.5", className)} {...props}>
			<DndContext
				id={dndContextId}
				sensors={sensors}
				collisionDetection={closestCenter}
				onDragStart={handleDragStart}
				onDragEnd={handleDragEnd}
				onDragCancel={handleDragCancel}
			>
				<div
					role="none"
					onClick={() => inputRef.current?.focus()}
					className="overflow-hidden rounded-lg border border-line-2 bg-bg/40 transition-colors focus-within:border-accent focus-within:ring-3 focus-within:ring-accent/50 dark:bg-line-2/20"
				>
					<div className="flex flex-col">
						<div
							className={cn("max-h-24 overflow-y-auto px-2 py-1.5", hasChips ? "border-b border-line/70" : "hidden")}
						>
							<SortableContext items={chips} strategy={rectSortingStrategy}>
								<div className="flex flex-wrap gap-1">
									{chips.map((chip, idx) => (
										<ChipItem
											key={chip}
											id={chip}
											chip={chip}
											index={idx}
											isEditing={editingIndex === idx}
											onEdit={handleEdit}
											onRemove={removeChip}
										/>
									))}
								</div>
							</SortableContext>
						</div>
						<div className={cn("flex items-center gap-1.5 px-2", hasChips ? "py-1.5" : "py-0")}>
							<Input
								ref={inputRef}
								type="text"
								id={controlId}
								value={input}
								autoComplete="off"
								// A resolvable aria-labelledby outranks aria-label, so a rendered FormLabel still wins;
								// when the FormControl has no FormLabel the reference dangles and the accessible name
								// falls back to aria-label instead of going empty.
								aria-label={isEditingKeyword ? t`Edit keyword` : t`Add keyword`}
								aria-labelledby={labelId}
								aria-describedby={describedBy}
								aria-invalid={invalid}
								placeholder={isEditingKeyword ? t`Editing keyword...` : t`Add a keyword...`}
								onKeyDown={handleKeyDown}
								onChange={handleInputChange}
								className="h-9 flex-1 border-none p-0 focus-visible:border-none focus-visible:ring-0 dark:bg-transparent"
							/>
							{chips.length > 0 && (
								<span
									className={cn(
										"flex h-6 min-w-6 shrink-0 items-center justify-center rounded-md border px-1.5 text-[0.7rem] font-medium tabular-nums",
										isEditingKeyword
											? "border-accent/30 bg-accent/10 text-accent-text"
											: "border-line bg-sunken/50 text-ink/80 opacity-80",
									)}
								>
									{isEditingKeyword ? <Trans>Edit</Trans> : chips.length}
								</span>
							)}
						</div>
					</div>
				</div>
				<ChipDragOverlay activeChip={activeChip} />
			</DndContext>

			{!hideDescription && (
				<p className="text-xs text-ink-3">
					{allowCommas ? (
						<Trans>
							Press <Kbd>{RETURN_KEY}</Kbd> to add or save the current keyword.
						</Trans>
					) : (
						<Trans>
							Press <Kbd>{RETURN_KEY}</Kbd> or <Kbd>{COMMA_KEY}</Kbd> to add or save the current keyword.
						</Trans>
					)}
				</p>
			)}
		</div>
	);
}
