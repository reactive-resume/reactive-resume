import type { ApplicationLane } from "../lanes";
import type { ApplicationClosedReason, ApplicationStatus } from "@reactive-resume/schema/applications/data";
import type { ApplicationPipeline } from "@reactive-resume/schema/applications/lanes";
import { closestCenter, DndContext, PointerSensor, useSensor, useSensors } from "@dnd-kit/core";
import { arrayMove, SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { t } from "@lingui/core/macro";
import { Plural, Trans } from "@lingui/react/macro";
import { ORPCError } from "@orpc/client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";
import { APPLICATION_STATUSES } from "@reactive-resume/schema/applications/data";
import { MAX_APPLICATION_LANES } from "@reactive-resume/schema/applications/lanes";
import { Alert, AlertDescription } from "@reactive-resume/ui/components/alert";
import { Button } from "@reactive-resume/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@reactive-resume/ui/components/dialog";
import { Icon } from "@reactive-resume/ui/components/icon";
import { IconButton } from "@reactive-resume/ui/components/icon-button";
import { Input } from "@reactive-resume/ui/components/input";
import { Kbd } from "@reactive-resume/ui/components/kbd";
import { Label } from "@reactive-resume/ui/components/label";
import { NativeSelect } from "@reactive-resume/ui/components/native-select";
import { Popover, PopoverContent, PopoverTrigger } from "@reactive-resume/ui/components/popover";
import {
	Sheet,
	SheetContent,
	SheetDescription,
	SheetFooter,
	SheetHeader,
	SheetTitle,
} from "@reactive-resume/ui/components/sheet";
import { toast } from "@reactive-resume/ui/components/toast";
import { cn } from "@reactive-resume/utils/style";
import { getDisplayLane, getLaneLabel, LANE_COLORS } from "../lanes";
import { applicationsListQueryKey, applicationsListQueryOptions } from "../queries";
import { CLOSED_REASONS, getClosedReasonLabel, getStageLabel } from "../stages";
import { applicationLanesQueryKey, useApplicationLanes } from "../use-application-lanes";
import { List, ListRow } from "@/components/calm/list-row";
import { StageDot } from "@/components/calm/stage-dot";
import { dndContextProps } from "@/libs/dnd";
import { getOrpcErrorMessage } from "@/libs/error-message";
import { isImeComposing } from "@/libs/keyboard";
import { client } from "@/libs/orpc/client";

type ManageLanesSheetProps = { open: boolean; onOpenChange: (open: boolean) => void };

/** What a stage counts as, in plain words. */
const categoryHint = (lane: Pick<ApplicationLane, "category" | "closedReason">) =>
	lane.category === "closed" && lane.closedReason
		? `${getStageLabel("closed")} · ${getClosedReasonLabel(lane.closedReason)}`
		: getStageLabel(lane.category);

/**
 * The owner's stages, each a row: recolor from the swatch, rename in place, reorder with Move up/down, add (Ghosted
 * is one click), and remove a stage you added after choosing where its applications go. Each stage counts as one of
 * the standard steps, which keeps reminders and Insights meaning the same.
 */
export function ManageLanesSheet({ open, onOpenChange }: ManageLanesSheetProps) {
	const formId = useId();
	const queryClient = useQueryClient();
	const { lanes, active, revision, mode, unsupported, error, refetch } = useApplicationLanes();
	const { data: applications } = useQuery({ ...applicationsListQueryOptions(), enabled: open });
	const [retiring, setRetiring] = useState<ApplicationLane | null>(null);

	// How many applications each stage holds, as the list and board place them.
	const counts = new Map<string, number>();
	for (const application of applications ?? []) {
		const id = getDisplayLane(lanes, application).id;
		counts.set(id, (counts.get(id) ?? 0) + 1);
	}

	const save = useMutation({
		mutationFn: (change: (expectedRevision: number) => Promise<ApplicationPipeline>) => change(revision),
		onSuccess: (pipeline) => {
			queryClient.setQueryData(applicationLanesQueryKey(), pipeline);
			// Removing a stage moves its applications.
			void queryClient.invalidateQueries({ queryKey: applicationsListQueryKey() });
		},
		onError: (failure) => {
			void refetch();
			toast.add({
				type: "error",
				description: getOrpcErrorMessage(failure, {
					byCode: { CONFLICT: t`Your stages changed somewhere else. They've been refreshed; try again.` },
					fallback: t`Couldn't save your stages. Try again.`,
					allowServerMessage: failure instanceof ORPCError && failure.code === "BAD_REQUEST",
				}),
			});
		},
	});
	const busy = save.isPending;
	const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
	const reorder = (from: number, to: number) => {
		if (busy || from < 0 || to < 0 || from === to) return;
		const ids = arrayMove(
			active.map((lane) => lane.id),
			from,
			to,
		);
		save.mutate((expectedRevision) => client.applications.lanes.reorder({ expectedRevision, ids }));
	};

	const add = (lane: NewLane, done?: () => void) =>
		save.mutate(
			(expectedRevision) => client.applications.lanes.create({ expectedRevision, ...lane }),
			done ? { onSuccess: done } : {},
		);
	const hasGhosted = active.some((lane) => lane.category === "closed" && lane.closedReason === "no-response");
	const full = active.length >= MAX_APPLICATION_LANES;
	const ready = mode === "lanes" && !unsupported && !error;

	return (
		<Sheet open={open} onOpenChange={onOpenChange}>
			<SheetContent closeLabel={t`Close`} side="right">
				<SheetHeader>
					<SheetTitle>
						<Trans>Stages</Trans>
					</SheetTitle>
					<SheetDescription className="sr-only">
						<Trans>Name, color and order the stages your applications move through.</Trans>
					</SheetDescription>
				</SheetHeader>

				<div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-6 pb-4">
					<p className="text-[13px]/[18px] text-ink-3">
						<Trans>
							The steps your applications move through. Each one counts as a standard step, so reminders and Insights
							keep working.
						</Trans>
					</p>
					{unsupported ? (
						<p className="mt-4 rounded-lg bg-sunken p-3 text-[13px]/[18px] text-ink-2">
							<Trans>This server doesn't support custom stages yet. Your applications use the standard ones.</Trans>
						</p>
					) : error ? (
						<Alert variant="error" className="mt-4">
							<Icon name="warning-circle" />
							<AlertDescription className="flex flex-wrap items-center justify-between gap-2">
								<Trans>Couldn't load your stages.</Trans>
								<Button size="sm" variant="secondary" onClick={() => void refetch()}>
									<Trans>Retry</Trans>
								</Button>
							</AlertDescription>
						</Alert>
					) : mode === "lanes" ? (
						<>
							<DndContext
								{...dndContextProps(false)}
								sensors={sensors}
								collisionDetection={closestCenter}
								onDragEnd={({ active: dragged, over }) => {
									if (over)
										reorder(
											active.findIndex((lane) => lane.id === dragged.id),
											active.findIndex((lane) => lane.id === over.id),
										);
								}}
							>
								<SortableContext items={active.map((lane) => lane.id)} strategy={verticalListSortingStrategy}>
									<List className="mt-2" role="list" aria-label={t`Stages, in order`}>
										{active.map((lane, index) => (
											<LaneRow
												key={lane.id}
												lane={lane}
												count={applications ? (counts.get(lane.id) ?? 0) : null}
												first={index === 0}
												last={index === active.length - 1}
												disabled={busy}
												onRename={(label) =>
													save.mutate((expectedRevision) =>
														client.applications.lanes.update({ expectedRevision, id: lane.id, label }),
													)
												}
												onColor={(color) =>
													save.mutate((expectedRevision) =>
														client.applications.lanes.update({ expectedRevision, id: lane.id, color }),
													)
												}
												onMove={(by) => reorder(index, index + by)}
												onRetire={() => setRetiring(lane)}
											/>
										))}
									</List>
								</SortableContext>
							</DndContext>

							<AddLaneForm id={formId} disabled={busy || full} full={full} onAdd={add} />
						</>
					) : (
						<p className="mt-4 text-[13px]/[18px] text-ink-3" aria-live="polite">
							<Trans>Loading…</Trans>
						</p>
					)}
				</div>

				{ready && (
					<SheetFooter className="flex-row items-center justify-between sm:justify-between">
						{hasGhosted ? (
							<span />
						) : (
							<button
								type="button"
								disabled={busy || full}
								className="text-start text-[13px]/5 font-medium text-accent-text hover:underline disabled:pointer-events-none disabled:opacity-45"
								onClick={() =>
									add({ label: t`Ghosted`, category: "closed", color: LANE_COLORS[0], closedReason: "no-response" })
								}
							>
								<Trans>Add “Ghosted” (closed, no response)</Trans>
							</button>
						)}
						<Button type="submit" form={formId} disabled={busy || full}>
							<Trans>Add stage</Trans>
						</Button>
					</SheetFooter>
				)}
			</SheetContent>

			{retiring && (
				<RetireLaneDialog
					lane={retiring}
					lanes={active}
					count={counts.get(retiring.id) ?? 0}
					disabled={busy}
					onCancel={() => setRetiring(null)}
					onRetire={(replacementId) =>
						save.mutate(
							(expectedRevision) =>
								client.applications.lanes.retire({ expectedRevision, id: retiring.id, replacementId }),
							{ onSettled: () => setRetiring(null) },
						)
					}
				/>
			)}
		</Sheet>
	);
}

type LaneRowProps = {
	lane: ApplicationLane;
	/** Applications in the stage; null while they load. */
	count: number | null;
	first: boolean;
	last: boolean;
	disabled: boolean;
	onRename: (label: string) => void;
	onColor: (color: string) => void;
	onMove: (by: -1 | 1) => void;
	onRetire: () => void;
};

function LaneRow({ lane, count, first, last, disabled, onRename, onColor, onMove, onRetire }: LaneRowProps) {
	const label = getLaneLabel(lane);
	const [draft, setDraft] = useState<string | null>(null);
	const commit = () => {
		if (draft === null) return;
		const next = draft.trim();
		setDraft(null);
		if (next && next !== label) onRename(next.slice(0, 80));
	};
	// A stage you added says what it counts as; Closed says whether it asks for a reason.
	const note =
		lane.category === "closed"
			? lane.closedReason
				? getClosedReasonLabel(lane.closedReason)
				: lane.systemKey
					? t`asks for a reason each time`
					: t`counts as ${getStageLabel("closed")}, asks for a reason each time`
			: lane.systemKey
				? null
				: t`counts as ${getStageLabel(lane.category)}`;
	const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
		id: lane.id,
		disabled,
		data: { label, group: t`Stages` },
	});
	const drag = {
		render: (
			<div
				ref={setNodeRef}
				style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : undefined }}
			/>
		),
	};
	const handle = (
		<button
			{...attributes}
			{...listeners}
			ref={setActivatorNodeRef}
			type="button"
			disabled={disabled}
			aria-label={t`Reorder ${label}`}
			aria-keyshortcuts="ArrowUp ArrowDown"
			onKeyDown={(event) => {
				if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
				event.preventDefault();
				event.stopPropagation();
				const by = event.key === "ArrowUp" ? -1 : 1;
				if (!disabled && !(by === -1 ? first : last)) onMove(by);
			}}
			className="relative cursor-grab touch-none text-ink-3 before:absolute before:-inset-1 active:cursor-grabbing"
		>
			<Icon name="dots-six-vertical" size={16} />
		</button>
	);
	const swatch = (
		<ColorSwatches
			value={lane.color}
			label={t`Color of ${label}`}
			disabled={disabled}
			onChange={(color) => color !== lane.color && onColor(color)}
		/>
	);

	if (draft !== null)
		return (
			<ListRow
				{...drag}
				role="listitem"
				className="min-h-[52px] py-2 sm:min-h-[52px]"
				leading={
					<span className="flex items-center gap-2">
						{handle}
						{swatch}
					</span>
				}
			>
				<Input
					aria-label={t`Name of ${label}`}
					value={draft}
					maxLength={80}
					// oxlint-disable-next-line jsx-a11y/no-autofocus -- the field opens because its name was pressed
					autoFocus
					className="h-9 flex-1"
					onChange={(event) => setDraft(event.target.value)}
					onFocus={(event) => event.target.select()}
					onBlur={commit}
					onKeyDown={(event) => {
						if (isImeComposing(event)) return;
						if (event.key === "Enter") commit();
						if (event.key === "Escape") {
							// Esc puts the old name back; it doesn't close the sheet.
							event.stopPropagation();
							setDraft(null);
						}
					}}
				/>
				<Kbd aria-hidden="true">↵</Kbd>
			</ListRow>
		);

	return (
		<ListRow
			{...drag}
			role="listitem"
			interactive
			className="min-h-[52px] py-2 sm:min-h-[52px]"
			leading={
				<span className="flex items-center gap-2">
					{handle}
					{swatch}
				</span>
			}
			title={
				<button
					type="button"
					disabled={disabled}
					aria-label={t`Rename ${label}`}
					className="relative z-10 block w-full cursor-text truncate rounded-xs text-start font-medium hover:underline"
					onClick={() => setDraft(label)}
				>
					{label}
				</button>
			}
			subtitle={
				// An empty stage shows no count, not a zero.
				count === null || count === 0 ? (
					note
				) : (
					<>
						<Plural value={count} one="# application" other="# applications" />
						{note && ` · ${note}`}
					</>
				)
			}
			actions={
				<span className="-me-1 flex items-center gap-3.5">
					<IconButton
						icon="arrow-up"
						size="icon-sm"
						variant="ghost"
						label={t`Move ${label} up`}
						disabled={disabled || first}
						onClick={() => onMove(-1)}
					/>
					<IconButton
						icon="arrow-down"
						size="icon-sm"
						variant="ghost"
						label={t`Move ${label} down`}
						disabled={disabled || last}
						onClick={() => onMove(1)}
					/>
					{/* Standard stages stay so every step always has somewhere to go. */}
					{!lane.systemKey && (
						<IconButton
							icon="trash"
							size="icon-sm"
							variant="ghost"
							label={t`Remove ${label}…`}
							disabled={disabled}
							onClick={onRetire}
						/>
					)}
				</span>
			}
		/>
	);
}

/** The ten stage colors; a color set elsewhere stays offered. */
const swatchColors = (value: string): readonly string[] =>
	LANE_COLORS.some((color) => color.toLowerCase() === value.toLowerCase()) ? LANE_COLORS : [value, ...LANE_COLORS];

type ColorChoicesProps = { value: string; label: string; disabled?: boolean; onChange: (color: string) => void };

/** The colors as a row of swatches; the chosen one wears a ring. */
function ColorChoices({ value, label, disabled, onChange }: ColorChoicesProps) {
	return (
		<div role="group" aria-label={label} className="flex min-h-10 flex-wrap content-center items-center gap-2">
			{swatchColors(value).map((color) => {
				const chosen = color.toLowerCase() === value.toLowerCase();
				return (
					<button
						key={color}
						type="button"
						aria-label={color}
						aria-pressed={chosen}
						disabled={disabled}
						onClick={() => onChange(color)}
						className={cn(
							"size-6 shrink-0 rounded-sm transition-[box-shadow,scale] duration-quick ease-enter focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent active:scale-[0.97] disabled:opacity-45",
							chosen && "shadow-[0_0_0_2px_var(--raised),0_0_0_4px_var(--ink)]",
						)}
						style={{ background: color }}
					/>
				);
			})}
		</div>
	);
}

/** A stage's swatch; it opens the colors in a popover. */
function ColorSwatches({ value, label, disabled, onChange }: ColorChoicesProps) {
	return (
		<Popover>
			<PopoverTrigger
				aria-label={label}
				disabled={disabled}
				className="relative z-10 grid size-7 shrink-0 place-items-center rounded-sm bg-raised shadow-[inset_0_0_0_1px_var(--line-2)] hover:bg-hover disabled:opacity-45"
			>
				<span className="size-3 rounded-full" style={{ background: value }} />
			</PopoverTrigger>
			<PopoverContent align="start" className="w-[184px] p-3">
				<ColorChoices value={value} label={label} onChange={onChange} />
			</PopoverContent>
		</Popover>
	);
}

type NewLane = {
	label: string;
	category: ApplicationStatus;
	color: string;
	closedReason: ApplicationClosedReason | null;
};

type AddLaneFormProps = {
	/** The form's id: the sheet's footer holds its submit button. */
	id: string;
	disabled: boolean;
	full: boolean;
	onAdd: (lane: NewLane, done: () => void) => void;
};

function AddLaneForm({ id, disabled, full, onAdd }: AddLaneFormProps) {
	const [label, setLabel] = useState("");
	const [category, setCategory] = useState<ApplicationStatus>("interview");
	const [outcome, setOutcome] = useState<ApplicationClosedReason | "">("");
	const [color, setColor] = useState<string>(LANE_COLORS[6]);
	const reset = () => {
		setLabel("");
		setOutcome("");
	};

	return (
		<section aria-labelledby={`${id}-title`} className="mt-1 grid gap-3.5 border-t border-line pt-[18px]">
			<h3 id={`${id}-title`} className="text-[15px]/[22px] font-semibold">
				<Trans>Add a stage</Trans>
			</h3>
			{full && (
				<p role="status" className="text-[13px]/[18px] text-ink-2">
					<Trans>You've reached {MAX_APPLICATION_LANES} stages. Remove one to add another.</Trans>
				</p>
			)}
			<form
				id={id}
				className="grid gap-3.5"
				onSubmit={(event) => {
					event.preventDefault();
					if (disabled || !label.trim()) return;
					onAdd(
						{
							label: label.trim().slice(0, 80),
							category,
							color,
							closedReason: category === "closed" && outcome ? outcome : null,
						},
						reset,
					);
				}}
			>
				<div className="grid gap-1.5">
					<Label htmlFor={`${id}-label`}>
						<Trans>Name</Trans>
					</Label>
					<Input
						id={`${id}-label`}
						value={label}
						required
						maxLength={80}
						placeholder={t`Take-home assignment`}
						disabled={disabled}
						onChange={(event) => setLabel(event.target.value)}
					/>
				</div>
				<div className="grid grid-cols-2 gap-3 max-sm:grid-cols-1">
					<div className="grid content-start gap-1.5">
						<Label htmlFor={`${id}-category`}>
							<Trans>Counts as</Trans>
						</Label>
						<div className="relative">
							<StageDot
								status={category}
								className="pointer-events-none absolute start-3 top-1/2 z-10 -translate-y-1/2"
							>
								{null}
							</StageDot>
							<NativeSelect
								id={`${id}-category`}
								className="ps-7"
								value={category}
								disabled={disabled}
								onChange={(event) => setCategory(event.target.value as ApplicationStatus)}
							>
								{APPLICATION_STATUSES.map((value) => (
									<option key={value} value={value}>
										{getStageLabel(value)}
									</option>
								))}
							</NativeSelect>
						</div>
					</div>
					<div className="grid content-start gap-1.5">
						<span id={`${id}-color`} className="text-[13px]/[18px] font-medium text-ink-2">
							<Trans>Color</Trans>
						</span>
						<ColorChoices value={color} label={t`New stage color`} disabled={disabled} onChange={setColor} />
					</div>
					{category === "closed" && (
						<div className="grid gap-1.5">
							<Label htmlFor={`${id}-outcome`}>
								<Trans>Outcome</Trans>
							</Label>
							<NativeSelect
								id={`${id}-outcome`}
								value={outcome}
								disabled={disabled}
								onChange={(event) => setOutcome(event.target.value as ApplicationClosedReason | "")}
							>
								<option value="">{t`Ask each time`}</option>
								{CLOSED_REASONS.map((reason) => (
									<option key={reason} value={reason}>
										{getClosedReasonLabel(reason)}
									</option>
								))}
							</NativeSelect>
						</div>
					)}
				</div>
				<p className="text-xs/4 text-ink-3">
					<Trans>
						What it counts as decides reminders, sent documents and Insights. It can't be changed later; add a new stage
						instead.
					</Trans>
				</p>
			</form>
		</section>
	);
}

type RetireLaneDialogProps = {
	lane: ApplicationLane;
	lanes: readonly ApplicationLane[];
	/** Applications the stage holds now. */
	count: number;
	disabled: boolean;
	onCancel: () => void;
	onRetire: (replacementId: string) => void;
};

/** Removing a stage moves its applications to a stage that counts the same; their history stays. */
function RetireLaneDialog({ lane, lanes, count, disabled, onCancel, onRetire }: RetireLaneDialogProps) {
	const id = useId();
	const label = getLaneLabel(lane);
	const options = lanes.filter(
		(item) => item.id !== lane.id && item.category === lane.category && item.closedReason === lane.closedReason,
	);
	// With one stage to move to, it's chosen already.
	const [replacementId, setReplacementId] = useState(options.length === 1 ? (options[0]?.id ?? "") : "");

	return (
		<Dialog open onOpenChange={(next) => !next && onCancel()}>
			<DialogContent closeLabel={t`Close`}>
				<form
					className="grid gap-[18px]"
					onSubmit={(event) => {
						event.preventDefault();
						if (replacementId) onRetire(replacementId);
					}}
				>
					<DialogHeader className="gap-1.5">
						<DialogTitle>
							<Trans>Remove “{label}”?</Trans>
						</DialogTitle>
						<DialogDescription>
							<Plural
								value={count}
								_0={`Its applications move to the stage you choose. Their history keeps the name “${label}”.`}
								one={`Its # application moves to the stage you choose. Its history keeps the name “${label}”.`}
								other={`Its # applications move to the stage you choose. Their history keeps the name “${label}”.`}
							/>
						</DialogDescription>
					</DialogHeader>
					{options.length > 0 ? (
						<div className="grid gap-1.5">
							<Label htmlFor={`${id}-replacement`}>
								<Trans>Move its applications to</Trans>
							</Label>
							<div className="relative">
								{replacementId && (
									<StageDot
										status={lane.category}
										color={options.find((option) => option.id === replacementId)?.color}
										className="pointer-events-none absolute start-3 top-1/2 z-10 -translate-y-1/2"
									>
										{null}
									</StageDot>
								)}
								<NativeSelect
									id={`${id}-replacement`}
									className={replacementId ? "ps-7" : undefined}
									required
									value={replacementId}
									onChange={(event) => setReplacementId(event.target.value)}
								>
									<option value="" disabled>
										{t`Choose a stage`}
									</option>
									{options.map((option) => (
										<option key={option.id} value={option.id}>
											{getLaneLabel(option)}
										</option>
									))}
								</NativeSelect>
							</div>
						</div>
					) : (
						<Alert variant="warn" role="alert">
							<Icon name="warning-circle" />
							<AlertDescription>
								<Trans>
									No other stage counts as {categoryHint(lane)}. Add one first, so its applications have somewhere to
									go.
								</Trans>
							</AlertDescription>
						</Alert>
					)}
					<DialogFooter>
						<Button type="button" variant="ghost" onClick={onCancel}>
							<Trans>Cancel</Trans>
						</Button>
						<Button type="submit" variant="danger" disabled={disabled || !replacementId}>
							<Trans>Remove stage</Trans>
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
