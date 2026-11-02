import type { CsvField } from "../csv";
import { plural, t } from "@lingui/core/macro";
import { Plural, Trans } from "@lingui/react/macro";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { Button } from "@reactive-resume/ui/components/button";
import { Icon } from "@reactive-resume/ui/components/icon";
import { Label } from "@reactive-resume/ui/components/label";
import { NativeSelect } from "@reactive-resume/ui/components/native-select";
import {
	Sheet,
	SheetContent,
	SheetDescription,
	SheetFooter,
	SheetHeader,
	SheetTitle,
} from "@reactive-resume/ui/components/sheet";
import { Textarea } from "@reactive-resume/ui/components/textarea";
import { toast } from "@reactive-resume/ui/components/toast";
import { downloadWithAnchor } from "@reactive-resume/utils/file";
import {
	applyLaneMapping,
	autoMapHeaders,
	collectCsvLanes,
	compatibleLanes,
	CSV_FIELDS,
	mapCsvToApplications,
	parseCsv,
	rowsToCsv,
	suggestLane,
} from "../csv";
import { getLaneLabel, LANE_COLORS } from "../lanes";
import { getClosedReasonLabel, getStageLabel } from "../stages";
import { useInvalidateApplications } from "../use-application-actions";
import { applicationLanesQueryKey, useApplicationLanes } from "../use-application-lanes";
import { client } from "@/libs/orpc/client";

/** A CSV lane's choice: one of this account's lanes, or a new one with the CSV's name. */
const NEW_LANE = "new";

const MAX_IMPORT = 500;
const SAMPLE =
	"Company,Role,Stage,Stage Date,Location,Salary,Source,Tags,Contact Name,Contact Email,Contact Phone\nStripe,Frontend Engineer,applied,2026-07-01,Remote,$180k,LinkedIn,remote;react,Jane Doe,jane@example.com,+1 555 0100";

const fieldLabel = (field: CsvField) =>
	({
		company: t`Company`,
		role: t`Role`,
		status: t`Stage`,
		stageEnteredAt: t`Stage date`,
		location: t`Location`,
		salary: t`Salary`,
		source: t`Source`,
		sourceUrl: t`Link`,
		jobDescription: t`Job description`,
		postingSource: t`Posting source`,
		notes: t`Notes`,
		tags: t`Tags`,
		contactName: t`Contact name`,
		contactRole: t`Contact role`,
		contactType: t`Contact label`,
		contactEmail: t`Contact email`,
		contactPhone: t`Contact phone`,
		archived: t`Archived (closes it)`,
		laneLabel: t`Stage name`,
		laneCategory: t`Stage counts as`,
		laneClosedReason: t`Stage outcome`,
		contacts: t`Contacts`,
	})[field];

type ImportSheetProps = { open: boolean; onOpenChange: (open: boolean) => void };

/**
 * Import from CSV: paste or upload, confirm how the columns were matched (they're matched automatically), then
 * import. Rows with no company or role are skipped and can be downloaded to fix.
 */
export function ImportApplicationsSheet({ open, onOpenChange }: ImportSheetProps) {
	const invalidate = useInvalidateApplications();
	const queryClient = useQueryClient();
	const { lanes, revision, mode, unsupported, refetch } = useApplicationLanes();
	const [text, setText] = useState("");
	const [overrides, setOverrides] = useState<Record<number, CsvField | null>>({});
	const [laneChoices, setLaneChoices] = useState<Record<string, string>>({});
	const [needsStageRefresh, setNeedsStageRefresh] = useState(false);
	const fileRef = useRef<HTMLInputElement>(null);

	const table = text.trim() ? parseCsv(text) : null;
	const headers = table?.[0] ?? [];
	const mapping = autoMapHeaders(headers).map((field, index) =>
		index in overrides ? (overrides[index] ?? null) : field,
	);
	const result = table ? mapCsvToApplications(table, mapping) : null;

	// The import endpoint takes 500 at a time; the rest is reported rather than refused.
	const importable = result ? result.rows.slice(0, MAX_IMPORT) : [];
	const overflow = (result?.rows.length ?? 0) - importable.length;
	// Every named lane is matched on purpose: a suggestion by name, else the person picks or creates one.
	const csvLanes = mode === "lanes" ? collectCsvLanes(importable) : [];
	const choiceFor = (lane: (typeof csvLanes)[number]) => laneChoices[lane.key] ?? suggestLane(lane, lanes) ?? "";
	const unmatched = csvLanes.filter((lane) => !choiceFor(lane)).length;
	const hasNamedStages = importable.some((row) => row.lane);
	const stagesUnresolved = hasNamedStages && ((mode !== "lanes" && !unsupported) || needsStageRefresh);
	const droppedLaneNames = unsupported && hasNamedStages;
	const refreshStages = async () => {
		const result = await refetch();
		if (result.isSuccess) setNeedsStageRefresh(false);
	};

	const reset = () => {
		setText("");
		setOverrides({});
		setLaneChoices({});
		setNeedsStageRefresh(false);
		if (fileRef.current) fileRef.current.value = "";
	};

	const importMutation = useMutation({
		mutationFn: async () => {
			if (stagesUnresolved) throw new Error("Load application stages before importing named stages.");
			const laneIds = new Map<string, string>();
			const before = new Set(lanes.map((item) => item.id));
			let expectedRevision = revision;
			for (const [index, lane] of csvLanes.entries()) {
				const choice = choiceFor(lane);
				if (choice !== NEW_LANE) {
					laneIds.set(lane.key, choice);
					continue;
				}
				const pipeline = await client.applications.lanes.create({
					expectedRevision,
					label: lane.label,
					category: lane.category,
					closedReason: lane.closedReason,
					color: LANE_COLORS[(index + 6) % LANE_COLORS.length] ?? LANE_COLORS[0],
				});
				queryClient.setQueryData(applicationLanesQueryKey(), pipeline);
				expectedRevision = pipeline.revision;
				const created = pipeline.lanes.find(
					(item) =>
						!before.has(item.id) &&
						item.label === lane.label &&
						item.category === lane.category &&
						item.closedReason === lane.closedReason,
				);
				if (!created) throw new Error("The new application stage wasn't returned. Refresh stages and try again.");
				laneIds.set(lane.key, created.id);
				before.add(created.id);
				// Successful stage creation survives a later failure in the same import attempt.
				setLaneChoices((current) => ({ ...current, [lane.key]: created.id }));
			}
			return client.applications.import({ items: applyLaneMapping(importable, laneIds) });
		},
		onSuccess: (response) => {
			invalidate();
			const skipped = result?.skipped ?? 0;
			toast.add({
				description:
					skipped > 0
						? `${plural(response.imported, { one: "Imported # application.", other: "Imported # applications." })} ${plural(skipped, { one: "# row had no company or role and was skipped.", other: "# rows had no company or role and were skipped." })}`
						: plural(response.imported, { one: "Imported # application.", other: "Imported # applications." }),
			});
			onOpenChange(false);
		},
		onError: async () => {
			invalidate();
			if (csvLanes.length > 0) {
				setNeedsStageRefresh(true);
				// A lost create response may have committed. Refresh and require the user to match it before retrying.
				setLaneChoices((current) =>
					Object.fromEntries(Object.entries(current).map(([key, value]) => [key, value === NEW_LANE ? "" : value])),
				);
				await refreshStages();
			}
			toast.add({ type: "error", description: t`Import failed. Check the CSV and try again.` });
		},
	});

	const downloadSkipped = () => {
		if (!result || result.skippedRows.length === 0) return;
		const blob = new Blob([rowsToCsv(headers, result.skippedRows)], { type: "text/csv" });
		downloadWithAnchor(blob, "skipped-applications.csv");
	};

	return (
		<Sheet
			open={open}
			onOpenChange={onOpenChange}
			// After an import, the rows clear once the sheet has slid away; closing without importing keeps them.
			onOpenChangeComplete={(next) => {
				if (next || !importMutation.isSuccess) return;
				reset();
				importMutation.reset();
			}}
		>
			<SheetContent closeLabel={t`Close`} side="right" className="w-full gap-0 data-[side=right]:sm:max-w-lg">
				<SheetHeader>
					<SheetTitle>
						<Trans>Import from CSV</Trans>
					</SheetTitle>
					<SheetDescription>
						<Trans>
							Paste rows or upload a .csv. Columns are matched automatically, and you check the match before anything is
							saved.
						</Trans>
					</SheetDescription>
				</SheetHeader>

				<div className="-mt-1 flex flex-1 flex-col gap-4 overflow-y-auto px-4 pt-1 pb-4">
					<div className="flex items-center gap-2">
						<Button size="sm" variant="secondary" onClick={() => fileRef.current?.click()}>
							<Icon name="file-arrow-up" size={16} />
							<Trans>Upload .csv</Trans>
						</Button>
						<Button size="sm" variant="ghost" onClick={() => setText(SAMPLE)}>
							<Trans>Use sample</Trans>
						</Button>
						<input
							ref={fileRef}
							type="file"
							accept=".csv,text/csv"
							className="hidden"
							onChange={(event) =>
								void event.target.files?.[0]
									?.text()
									.then((value) => {
										setOverrides({});
										setLaneChoices({});
										setText(value);
									})
									.catch(() =>
										toast.add({
											type: "error",
											description: t`Couldn't read that file. Choose a .csv file and try again.`,
										}),
									)
							}
						/>
					</div>

					<div className="grid gap-1.5">
						<Label htmlFor="import-csv-text">
							<Trans>CSV data</Trans>
						</Label>
						<Textarea
							id="import-csv-text"
							value={text}
							rows={6}
							placeholder="Company,Role,Stage,…"
							className="font-mono text-xs"
							onChange={(event) => {
								setOverrides({});
								setLaneChoices({});
								setText(event.target.value);
							}}
						/>
					</div>

					{stagesUnresolved && (
						<div role="alert" className="grid gap-2 rounded-lg border border-line p-3 text-sm">
							<p>
								<Trans>Load your stages before importing named stages. Your CSV data is kept.</Trans>
							</p>
							<Button size="sm" variant="secondary" onClick={() => void refreshStages()}>
								<Trans>Retry</Trans>
							</Button>
						</div>
					)}

					{result && headers.length > 0 && (
						<section aria-labelledby="import-columns" className="grid gap-2">
							<h3 id="import-columns" className="text-sm font-semibold">
								<Trans>Columns</Trans>
							</h3>
							<ul className="grid gap-1.5">
								{headers.map((header, index) => (
									<li
										key={`${header}-${index}`}
										className="grid grid-cols-[minmax(0,1fr)_16px_minmax(0,1fr)] items-center gap-2 text-sm"
									>
										<span className="truncate font-mono text-xs">{header || t`(no header)`}</span>
										<Icon name="arrow-right" size={16} className="text-ink-3" />
										<NativeSelect
											aria-label={t`Column ${header} goes to`}
											value={mapping[index] ?? ""}
											onChange={(event) =>
												setOverrides((current) => ({
													...current,
													[index]: (event.target.value || null) as CsvField | null,
												}))
											}
										>
											<option value="">{t`Leave out`}</option>
											{CSV_FIELDS.map((field) => (
												<option key={field} value={field}>
													{fieldLabel(field)}
												</option>
											))}
										</NativeSelect>
									</li>
								))}
							</ul>

							{csvLanes.length > 0 && (
								<div className="grid gap-1.5 pt-2">
									<h3 className="text-sm font-semibold">
										<Trans>Stages</Trans>
									</h3>
									<p className="text-xs text-ink-3">
										<Trans>Choose where each stage named in the file goes, or add it as a new stage.</Trans>
									</p>
									<ul className="grid gap-1.5">
										{csvLanes.map((lane) => {
											const hint =
												lane.category === "closed" && lane.closedReason
													? `${getStageLabel("closed")} · ${getClosedReasonLabel(lane.closedReason)}`
													: getStageLabel(lane.category);
											return (
												<li
													key={lane.key}
													className="grid grid-cols-[minmax(0,1fr)_16px_minmax(0,1fr)] items-center gap-2 text-sm"
												>
													<span className="grid min-w-0">
														<span className="truncate">{lane.label}</span>
														<span className="truncate text-xs text-ink-3">{hint}</span>
													</span>
													<Icon name="arrow-right" size={16} className="text-ink-3" />
													<NativeSelect
														aria-label={t`Stage ${lane.label} goes to`}
														value={choiceFor(lane)}
														onChange={(event) =>
															setLaneChoices((current) => ({ ...current, [lane.key]: event.target.value }))
														}
													>
														<option value="" disabled>
															{t`Choose a stage`}
														</option>
														{compatibleLanes(lane, lanes).map((option) => (
															<option key={option.id} value={option.id}>
																{getLaneLabel(option)}
															</option>
														))}
														<option value={NEW_LANE}>{t`Add “${lane.label}” as a new stage`}</option>
													</NativeSelect>
												</li>
											);
										})}
									</ul>
								</div>
							)}

							<div className="grid gap-1 rounded-lg border border-line p-3 text-sm">
								{result.invalidValues.length > 0 && (
									<div role="alert" className="grid gap-1 text-warn-text">
										<p>
											<Trans>Fix these values in the CSV, or leave their columns out, before importing.</Trans>
										</p>
										<ul className="list-disc ps-4">
											{result.invalidValues.map(({ row, field, value }) => (
												<li key={`${row}:${field}`}>
													<Trans>
														Row {row}, {fieldLabel(field)}: “{value}” is invalid.
													</Trans>
												</li>
											))}
										</ul>
									</div>
								)}
								<p className="flex items-center gap-1.5 font-medium">
									<Icon name="check-circle" size={18} className="text-accent-text" />
									<Plural
										value={importable.length}
										one="# application ready to import"
										other="# applications ready to import"
									/>
								</p>
								{result.skipped > 0 && (
									<p className="text-xs text-ink-2">
										<Plural
											value={result.skipped}
											one="# row has no company or role and will be skipped."
											other="# rows have no company or role and will be skipped."
										/>{" "}
										<button
											type="button"
											className="font-medium underline underline-offset-2"
											onClick={downloadSkipped}
										>
											<Trans>Download them</Trans>
										</button>
									</p>
								)}
								{result.contactsSkipped > 0 && (
									<p className="text-xs text-ink-3">
										<Plural
											value={result.contactsSkipped}
											one="# contact has an invalid email or no name; its application still imports."
											other="# contacts have an invalid email or no name; their applications still import."
										/>
									</p>
								)}
								{unmatched > 0 && (
									<p className="text-xs text-warn-text">
										<Plural
											value={unmatched}
											one="Choose where # stage goes before importing."
											other="Choose where # stages go before importing."
										/>
									</p>
								)}
								{droppedLaneNames && (
									<p className="text-xs text-ink-3">
										<Trans>This server uses the standard stages, so stage names in the file aren't kept.</Trans>
									</p>
								)}
								{overflow > 0 && (
									<p className="text-xs text-warn-text">
										<Trans>
											Only the first {MAX_IMPORT} rows import at once, leaving out {overflow}. Split the file to import
											the rest.
										</Trans>
									</p>
								)}
							</div>
						</section>
					)}
				</div>

				<SheetFooter className="flex-row justify-end gap-2">
					<Button variant="secondary" onClick={() => onOpenChange(false)}>
						<Trans>Cancel</Trans>
					</Button>
					<Button
						disabled={
							importable.length === 0 ||
							(result?.invalidValues.length ?? 0) > 0 ||
							unmatched > 0 ||
							stagesUnresolved ||
							importMutation.isPending
						}
						onClick={() => {
							if (!result?.invalidValues.length && unmatched === 0 && !stagesUnresolved) importMutation.mutate();
						}}
					>
						<Plural value={importable.length} one="Import # application" other="Import # applications" />
					</Button>
				</SheetFooter>
			</SheetContent>
		</Sheet>
	);
}
