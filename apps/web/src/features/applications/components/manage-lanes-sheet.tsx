import type { ApplicationLane } from "../lanes";
import type { ApplicationClosedReason, ApplicationStatus } from "@reactive-resume/schema/applications/data";
import type { ApplicationPipeline } from "@reactive-resume/schema/applications/lanes";
import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { ORPCError } from "@orpc/client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";
import { APPLICATION_STATUSES } from "@reactive-resume/schema/applications/data";
import { MAX_APPLICATION_LANES } from "@reactive-resume/schema/applications/lanes";
import { Button } from "@reactive-resume/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@reactive-resume/ui/components/dialog";
import { IconButton } from "@reactive-resume/ui/components/icon-button";
import { Input } from "@reactive-resume/ui/components/input";
import { Label } from "@reactive-resume/ui/components/label";
import { NativeSelect } from "@reactive-resume/ui/components/native-select";
import { Popover, PopoverContent, PopoverTrigger } from "@reactive-resume/ui/components/popover";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@reactive-resume/ui/components/sheet";
import { toast } from "@reactive-resume/ui/components/toast";
import { cn } from "@reactive-resume/utils/style";
import { getLaneLabel, LANE_COLORS } from "../lanes";
import { applicationsListQueryKey } from "../queries";
import { CLOSED_REASONS, getClosedReasonLabel, getStageLabel } from "../stages";
import { applicationLanesQueryKey, useApplicationLanes } from "../use-application-lanes";
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
 * The owner's stages: rename, recolor, reorder with Move up/down, add (Ghosted is one click), and remove a custom
 * stage after choosing where its applications go. Each stage counts as one of the standard steps, which keeps
 * reminders and Insights meaning the same.
 */
export function ManageLanesSheet({ open, onOpenChange }: ManageLanesSheetProps) {
	const queryClient = useQueryClient();
	const { active, revision, mode, unsupported, error, refetch } = useApplicationLanes();
	const [retiring, setRetiring] = useState<ApplicationLane | null>(null);

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

	const move = (index: number, by: -1 | 1) => {
		const ids = active.map((lane) => lane.id);
		const [id] = ids.splice(index, 1);
		if (!id) return;
		ids.splice(index + by, 0, id);
		save.mutate((expectedRevision) => client.applications.lanes.reorder({ expectedRevision, ids }));
	};
	const hasGhosted = active.some((lane) => lane.category === "closed" && lane.closedReason === "no-response");

	return (
		<Sheet open={open} onOpenChange={onOpenChange}>
			<SheetContent side="right" className="w-full gap-0 data-[side=right]:sm:max-w-lg">
				<SheetHeader>
					<SheetTitle>
						<Trans>Stages</Trans>
					</SheetTitle>
					<SheetDescription>
						<Trans>
							Name, color and order the stages your applications move through. Each one counts as a standard step, so
							reminders and Insights keep working.
						</Trans>
					</SheetDescription>
				</SheetHeader>

				<div className="-mt-1 flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-4 pt-1 pb-4">
					{unsupported ? (
						<p className="rounded-lg bg-sunken p-3 text-sm text-ink-2">
							<Trans>This server doesn't support custom stages yet. Your applications use the standard ones.</Trans>
						</p>
					) : error ? (
						<div
							role="alert"
							className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line p-3"
						>
							<p className="text-sm text-danger-text">
								<Trans>Couldn't load your stages.</Trans>
							</p>
							<Button size="sm" variant="secondary" onClick={() => void refetch()}>
								<Trans>Retry</Trans>
							</Button>
						</div>
					) : mode === "lanes" ? (
						<>
							<ol aria-label={t`Stages`} className="grid gap-1.5">
								{active.map((lane, index) => (
									<LaneRow
										key={lane.id}
										lane={lane}
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
										onMove={(by) => move(index, by)}
										onRetire={() => setRetiring(lane)}
									/>
								))}
							</ol>

							<AddLaneForm
								disabled={busy || active.length >= MAX_APPLICATION_LANES}
								full={active.length >= MAX_APPLICATION_LANES}
								hasGhosted={hasGhosted}
								onAdd={(lane, done) =>
									save.mutate((expectedRevision) => client.applications.lanes.create({ expectedRevision, ...lane }), {
										onSuccess: done,
									})
								}
							/>
						</>
					) : (
						<p className="text-sm text-ink-3" aria-live="polite">
							<Trans>Loading…</Trans>
						</p>
					)}
				</div>
			</SheetContent>

			{retiring && (
				<RetireLaneDialog
					lane={retiring}
					lanes={active}
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
	first: boolean;
	last: boolean;
	disabled: boolean;
	onRename: (label: string) => void;
	onColor: (color: string) => void;
	onMove: (by: -1 | 1) => void;
	onRetire: () => void;
};

function LaneRow({ lane, first, last, disabled, onRename, onColor, onMove, onRetire }: LaneRowProps) {
	const label = getLaneLabel(lane);
	const [draft, setDraft] = useState<string | null>(null);
	const commit = () => {
		if (draft === null) return;
		const next = draft.trim();
		setDraft(null);
		if (next && next !== label) onRename(next.slice(0, 80));
	};

	return (
		<li className="flex items-center gap-2 rounded-lg border border-line bg-surface p-2">
			<ColorSwatches
				value={lane.color}
				label={t`Color of ${label}`}
				disabled={disabled}
				onChange={(color) => color !== lane.color && onColor(color)}
			/>
			<div className="grid min-w-0 flex-1 gap-0.5">
				<Input
					aria-label={t`Name of ${label}`}
					value={draft ?? label}
					maxLength={80}
					disabled={disabled}
					className="h-8"
					onChange={(event) => setDraft(event.target.value)}
					onBlur={commit}
					onKeyDown={(event) => {
						if (isImeComposing(event)) return;
						if (event.key === "Enter") commit();
						if (event.key === "Escape") {
							event.stopPropagation();
							setDraft(null);
						}
					}}
				/>
				<span className="truncate px-1 text-xs text-ink-3">{categoryHint(lane)}</span>
			</div>
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
			{lane.systemKey ? (
				// Standard stages stay so every step always has somewhere to go.
				<span className="size-8 shrink-0" aria-hidden="true" />
			) : (
				<IconButton
					icon="trash"
					size="icon-sm"
					variant="ghost"
					label={t`Remove ${label}…`}
					disabled={disabled}
					className="text-ink-3"
					onClick={onRetire}
				/>
			)}
		</li>
	);
}

type ColorSwatchesProps = { value: string; label: string; disabled?: boolean; onChange: (color: string) => void };

/** A small palette in a popover; a color set elsewhere stays offered. */
function ColorSwatches({ value, label, disabled, onChange }: ColorSwatchesProps) {
	const colors: readonly string[] = LANE_COLORS.some((color) => color.toLowerCase() === value.toLowerCase())
		? LANE_COLORS
		: [value, ...LANE_COLORS];
	return (
		<Popover>
			<PopoverTrigger
				aria-label={label}
				disabled={disabled}
				className="grid size-8 shrink-0 place-items-center rounded-md hover:bg-hover disabled:opacity-50"
			>
				<span className="size-4 rounded-sm" style={{ background: value }} />
			</PopoverTrigger>
			<PopoverContent align="start" className="w-auto p-2">
				<div role="group" aria-label={label} className="grid grid-cols-5 gap-1.5">
					{colors.map((color) => (
						<button
							key={color}
							type="button"
							aria-label={color}
							aria-pressed={color.toLowerCase() === value.toLowerCase()}
							onClick={() => onChange(color)}
							className={cn(
								"size-7 rounded-md border-2 border-transparent transition-transform duration-quick ease-enter focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-hidden active:scale-[0.97]",
								color.toLowerCase() === value.toLowerCase() && "border-ink",
							)}
							style={{ background: color }}
						/>
					))}
				</div>
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
	disabled: boolean;
	full: boolean;
	hasGhosted: boolean;
	onAdd: (lane: NewLane, done: () => void) => void;
};

function AddLaneForm({ disabled, full, hasGhosted, onAdd }: AddLaneFormProps) {
	const id = useId();
	const [label, setLabel] = useState("");
	const [category, setCategory] = useState<ApplicationStatus>("interview");
	const [outcome, setOutcome] = useState<ApplicationClosedReason | "">("");
	const [color, setColor] = useState<string>(LANE_COLORS[6]);
	const reset = () => {
		setLabel("");
		setOutcome("");
	};

	return (
		<section aria-labelledby={`${id}-title`} className="grid gap-3 border-t border-line pt-4">
			<h3 id={`${id}-title`} className="text-sm font-semibold">
				<Trans>Add a stage</Trans>
			</h3>
			{full && (
				<p className="text-xs text-ink-3">
					<Trans>You've reached {MAX_APPLICATION_LANES} stages. Remove one to add another.</Trans>
				</p>
			)}
			<form
				className="grid gap-3"
				onSubmit={(event) => {
					event.preventDefault();
					if (!label.trim()) return;
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
				<div className="flex items-end gap-2">
					<ColorSwatches value={color} label={t`New stage color`} disabled={disabled} onChange={setColor} />
					<div className="grid flex-1 gap-1.5">
						<Label htmlFor={`${id}-label`}>
							<Trans>Name</Trans>
						</Label>
						<Input
							id={`${id}-label`}
							value={label}
							maxLength={80}
							placeholder={t`Take-home assignment`}
							disabled={disabled}
							onChange={(event) => setLabel(event.target.value)}
						/>
					</div>
				</div>
				<div className="grid grid-cols-2 gap-3 max-sm:grid-cols-1">
					<div className="grid gap-1.5">
						<Label htmlFor={`${id}-category`}>
							<Trans>Counts as</Trans>
						</Label>
						<NativeSelect
							id={`${id}-category`}
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
				<p className="text-xs text-ink-3">
					<Trans>
						What it counts as decides reminders, sent documents and Insights. It can't be changed later; add a new stage
						instead.
					</Trans>
				</p>
				<div className="flex flex-wrap gap-2">
					<Button type="submit" disabled={disabled || !label.trim()}>
						<Trans>Add stage</Trans>
					</Button>
					{!hasGhosted && (
						<Button
							type="button"
							variant="secondary"
							disabled={disabled}
							onClick={() =>
								onAdd(
									{ label: t`Ghosted`, category: "closed", color: LANE_COLORS[0], closedReason: "no-response" },
									reset,
								)
							}
						>
							<Trans>Add Ghosted (closed, no response)</Trans>
						</Button>
					)}
				</div>
			</form>
		</section>
	);
}

type RetireLaneDialogProps = {
	lane: ApplicationLane;
	lanes: readonly ApplicationLane[];
	disabled: boolean;
	onCancel: () => void;
	onRetire: (replacementId: string) => void;
};

/** Removing a stage moves its applications to a stage that counts the same; their history stays. */
function RetireLaneDialog({ lane, lanes, disabled, onCancel, onRetire }: RetireLaneDialogProps) {
	const id = useId();
	const label = getLaneLabel(lane);
	const options = lanes.filter(
		(item) => item.id !== lane.id && item.category === lane.category && item.closedReason === lane.closedReason,
	);
	const [replacementId, setReplacementId] = useState("");

	return (
		<Dialog open onOpenChange={(next) => !next && onCancel()}>
			<DialogContent className="sm:max-w-sm">
				<form
					className="grid gap-4"
					onSubmit={(event) => {
						event.preventDefault();
						if (replacementId) onRetire(replacementId);
					}}
				>
					<DialogHeader>
						<DialogTitle>
							<Trans>Remove “{label}”?</Trans>
						</DialogTitle>
						<DialogDescription>
							<Trans>Its applications move to the stage you choose. Their history keeps the name “{label}”.</Trans>
						</DialogDescription>
					</DialogHeader>
					{options.length > 0 ? (
						<div className="grid gap-1.5">
							<Label htmlFor={`${id}-replacement`}>
								<Trans>Move its applications to</Trans>
							</Label>
							<NativeSelect
								id={`${id}-replacement`}
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
					) : (
						<p role="alert" className="text-sm text-warn-text">
							<Trans>
								No other stage counts as {categoryHint(lane)}. Add one first, so its applications have somewhere to go.
							</Trans>
						</p>
					)}
					<DialogFooter>
						<Button type="button" variant="secondary" onClick={onCancel}>
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
