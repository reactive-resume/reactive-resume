import type { CsvField } from "@reactive-resume/schema/applications/csv";
import { i18n } from "@lingui/core";
import { ph, plural, t } from "@lingui/core/macro";
import { Plural, Trans } from "@lingui/react/macro";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import {
	applyLaneMapping,
	autoMapHeaders,
	collectCsvLanes,
	compatibleLanes,
	CSV_FIELDS,
	CSV_SAMPLE,
	mapCsvToApplications,
	parseCsv,
	rowsToCsv,
	suggestLane,
} from "@reactive-resume/schema/applications/csv";
import { Alert, AlertDescription, AlertTitle } from "@reactive-resume/ui/components/alert";
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
import { cn } from "@reactive-resume/utils/style";
import { getLaneLabel, LANE_COLORS } from "../lanes";
import { getClosedReasonLabel, getStageLabel } from "../stages";
import { useInvalidateApplications } from "../use-application-actions";
import { applicationLanesQueryKey, useApplicationLanes } from "../use-application-lanes";
import { client } from "@/libs/orpc/client";

/** A CSV lane's choice: one of this account's lanes, or a new one with the CSV's name. */
const NEW_LANE = "new";

const MAX_IMPORT = 500;

// One mapping row: what the file calls it, an arrow, where it goes.
const mapRowClassName = "grid grid-cols-[minmax(0,150px)_16px_minmax(0,1fr)] items-center gap-2.5";
const mapHeadingClassName = "flex items-baseline justify-between gap-2 text-[13px]/[18px] font-medium text-ink-2";

const fieldLabel = (field: CsvField) =>
	({
		company: t`Company`,
		role: t`Role`,
		status: t`Stage`,
		stageEnteredAt: t`Stage date`,
		applicationDate: t`Application date`,
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
		closedReason: t`Outcome`,
		contacts: t`Contacts`,
	})[field];

type ImportSheetProps = { open: boolean; onOpenChange: (open: boolean) => void };

/**
 * Import from CSV: the file (or its rows pasted), where each column goes (matched automatically), where each stage
 * named in the file goes, then what will happen. Rows with no company or role are skipped and can be downloaded to fix.
 */
export function ImportApplicationsSheet({ open, onOpenChange }: ImportSheetProps) {
	const invalidate = useInvalidateApplications();
	const queryClient = useQueryClient();
	const { lanes, revision, mode, unsupported, refetch } = useApplicationLanes();
	const [text, setText] = useState("");
	const [overrides, setOverrides] = useState<Record<number, CsvField | null>>({});
	const [laneChoices, setLaneChoices] = useState<Record<string, string>>({});
	const [needsStageRefresh, setNeedsStageRefresh] = useState(false);
	const [reading, setReading] = useState(false);
	// The chosen file's name, until its rows are edited or pasted over.
	const [fileName, setFileName] = useState<string | null>(null);
	const [pasting, setPasting] = useState(false);
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

	const changeText = (value: string) => {
		setOverrides({});
		setLaneChoices({});
		setFileName(null);
		setText(value);
	};

	const reset = () => {
		setText("");
		setOverrides({});
		setLaneChoices({});
		setNeedsStageRefresh(false);
		setFileName(null);
		setPasting(false);
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
	const working = reading || importMutation.isPending;

	const downloadSkipped = () => {
		if (!result || result.skippedRows.length === 0) return;
		const blob = new Blob([rowsToCsv(headers, result.skippedRows)], { type: "text/csv" });
		downloadWithAnchor(blob, "skipped-applications.csv");
	};

	return (
		<Sheet
			open={open}
			onOpenChange={(next) => {
				if (!working) onOpenChange(next);
			}}
			// After an import, the rows clear once the sheet has slid away; closing without importing keeps them.
			onOpenChangeComplete={(next) => {
				if (next || !importMutation.isSuccess) return;
				reset();
				importMutation.reset();
			}}
		>
			<SheetContent closeLabel={t`Close`} side="right">
				<SheetHeader className="gap-1.5">
					<SheetTitle>
						<Trans>Import from CSV</Trans>
					</SheetTitle>
					<SheetDescription className="text-ink-2">
						<Trans>Columns are matched for you. Check the match before anything is saved.</Trans>
					</SheetDescription>
				</SheetHeader>

				<div className="flex flex-1 flex-col gap-[18px] overflow-y-auto px-6 pb-4">
					{/* The file: chosen, replaced, or its rows pasted instead. */}
					<div className="flex items-center gap-x-3 gap-y-2 rounded-lg px-3 py-2.5 outline-1 -outline-offset-1 outline-line-2 outline-dashed max-sm:flex-wrap">
						<Icon name="file-csv" size={20} className="shrink-0 text-ink-2" />
						<span className="flex min-w-0 flex-1 flex-col max-sm:basis-32">
							<span className="truncate text-sm/5 font-medium">
								{table ? (fileName ?? <Trans>Pasted rows</Trans>) : <Trans>Choose a .csv file</Trans>}
							</span>
							<span className="truncate text-xs/4 text-ink-3">
								{table ? (
									<>
										<Plural value={Math.max(table.length - 1, 0)} one="# row" other="# rows" />
										{" · "}
										<Plural value={headers.length} one="# column" other="# columns" />
									</>
								) : (
									<Trans>Or paste its rows.</Trans>
								)}
							</span>
						</span>
						<Button
							size="sm"
							variant="ghost"
							disabled={working}
							aria-expanded={pasting}
							onClick={() => setPasting((open) => !open)}
						>
							<Trans>Paste rows instead</Trans>
						</Button>
						<Button
							size="sm"
							variant="secondary"
							disabled={working}
							aria-busy={reading}
							onClick={() => fileRef.current?.click()}
						>
							{table && fileName ? <Trans>Replace</Trans> : <Trans>Upload .csv</Trans>}
						</Button>
						<input
							ref={fileRef}
							type="file"
							disabled={working}
							accept=".csv,text/csv"
							className="hidden"
							onChange={(event) => {
								const file = event.target.files?.[0];
								if (!file || working) return;
								event.target.value = "";
								setReading(true);
								void file
									.text()
									.then((value) => {
										changeText(value);
										setFileName(file.name);
										setPasting(false);
									})
									.catch(() =>
										toast.add({
											type: "error",
											description: t`Couldn't read that file. Choose a .csv file and try again.`,
										}),
									)
									.finally(() => setReading(false));
							}}
						/>
					</div>

					{pasting && (
						<div className="grid gap-1.5">
							<Label htmlFor="import-csv-text" className="justify-between">
								<Trans>CSV data</Trans>
								<button
									type="button"
									disabled={working}
									className="font-medium text-accent-text hover:underline"
									onClick={() => changeText(CSV_SAMPLE)}
								>
									<Trans>Use sample</Trans>
								</button>
							</Label>
							<Textarea
								id="import-csv-text"
								value={text}
								rows={text ? 4 : 6}
								disabled={working}
								placeholder="Company,Role,Stage,…"
								className="font-mono text-xs"
								onChange={(event) => {
									changeText(event.target.value);
								}}
							/>
						</div>
					)}

					{stagesUnresolved && (
						<Alert variant="warn" role="alert">
							<Icon name="warning-circle" />
							<AlertDescription className="flex flex-wrap items-center justify-between gap-2">
								<Trans>Load your stages before importing named stages. Your CSV data is kept.</Trans>
								<Button size="sm" variant="secondary" disabled={working} onClick={() => void refreshStages()}>
									<Trans>Retry</Trans>
								</Button>
							</AlertDescription>
						</Alert>
					)}

					{result && headers.length > 0 && (
						<>
							<section aria-labelledby="import-columns" className="grid gap-1.5">
								<h3 id="import-columns" className={mapHeadingClassName}>
									<Trans>Columns</Trans>
									<span className="text-xs/4 font-normal text-ink-3">
										<Trans>from the file → goes to</Trans>
									</span>
								</h3>
								<ul className="grid gap-1.5">
									{headers.map((header, index) => (
										<li key={`${header}-${index}`} className={mapRowClassName}>
											<span className="truncate font-mono text-xs/4">{header || t`(no header)`}</span>
											<Icon name="arrow-right" size={16} className="text-ink-3 rtl:-scale-x-100" />
											<NativeSelect
												disabled={working}
												aria-label={t`Column ${header} goes to`}
												value={mapping[index] ?? ""}
												className={cn("h-8 pointer-coarse:h-11", !mapping[index] && "text-ink-3")}
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
							</section>

							{csvLanes.length > 0 && (
								<section aria-labelledby="import-stages" className="grid gap-1.5">
									<h3 id="import-stages" className={mapHeadingClassName}>
										<Trans>Stages</Trans>
										<span className="text-xs/4 font-normal text-ink-3">
											<Trans>named in the file → your stage</Trans>
										</span>
									</h3>
									<ul className="grid gap-1.5">
										{csvLanes.map((lane) => {
											const hint =
												lane.category === "closed" && lane.closedReason
													? `${getStageLabel("closed")} · ${getClosedReasonLabel(lane.closedReason)}`
													: getStageLabel(lane.category);
											return (
												<li key={lane.key} className={mapRowClassName}>
													<span className="grid min-w-0">
														<span className="truncate font-mono text-xs/4">{lane.label}</span>
														<span className="truncate text-xs/4 text-ink-3">{hint}</span>
													</span>
													<Icon name="arrow-right" size={16} className="text-ink-3 rtl:-scale-x-100" />
													<NativeSelect
														disabled={working}
														aria-label={t`Stage ${lane.label} goes to`}
														value={choiceFor(lane)}
														className="h-8 pointer-coarse:h-11"
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
								</section>
							)}

							{/* What will happen. Values that can't be read keep Import dimmed until they are fixed or left out. */}
							{result.invalidValues.length > 0 && (
								<Alert variant="error">
									<Icon name="warning-circle" />
									<AlertTitle>
										<Trans>Fix these in the file, or leave their columns out</Trans>
									</AlertTitle>
									<AlertDescription>
										<ul className="grid gap-1.5 pt-1">
											{result.invalidValues.map(({ row, field, value }) => (
												<li key={`${row}:${field}`}>
													{field === "stageEnteredAt" ? (
														<Trans>
															Row {row}: couldn't read the date “{value}”. Use a date like 2026-10-15.
														</Trans>
													) : field === "status" ? (
														<Trans>
															Row {row}: “{value}” isn't a stage. Use Saved, Applied, Screening, Interview, Offer or
															Closed.
														</Trans>
													) : (
														<Trans>
															Row {row}, {fieldLabel(field)}: couldn't read “{value}”.
														</Trans>
													)}
												</li>
											))}
										</ul>
									</AlertDescription>
								</Alert>
							)}
							<div className="grid gap-1.5 border-t border-line pt-3.5">
								<p className="flex items-center gap-2 text-sm/5 font-medium">
									<Icon name="check-circle" size={18} className="shrink-0 text-accent-text" />
									<Plural
										value={importable.length}
										one="# application ready to import"
										other="# applications ready to import"
									/>
								</p>
								<div className="grid gap-1 ps-[26px] text-[13px]/[18px] text-ink-3 empty:hidden">
									{result.skipped > 0 && (
										<p>
											<Plural
												value={result.skipped}
												one="# row has no company or role and will be skipped."
												other="# rows have no company or role and will be skipped."
											/>{" "}
											<button
												type="button"
												className="font-medium text-accent-text hover:underline"
												onClick={downloadSkipped}
											>
												<Plural value={result.skipped} one="Download it" other="Download them" />
											</button>
										</p>
									)}
									{result.contactsSkipped > 0 && (
										<p>
											<Plural
												value={result.contactsSkipped}
												one="# contact has an invalid email or no name; its application still imports."
												other="# contacts have an invalid email or no name; their applications still import."
											/>
										</p>
									)}
									{unmatched > 0 && (
										<p className="text-warn-text">
											<Plural
												value={unmatched}
												one="Choose where # stage goes before importing."
												other="Choose where # stages go before importing."
											/>
										</p>
									)}
									{droppedLaneNames && (
										<p>
											<Trans>This server uses the standard stages, so stage names in the file aren't kept.</Trans>
										</p>
									)}
									{overflow > 0 && (
										<p className="text-warn-text">
											<Trans>
												Only the first {ph({ MAX_IMPORT: i18n.number(MAX_IMPORT) })} rows import at once, leaving out{" "}
												{ph({ overflow: i18n.number(overflow) })}. Split the file to import the rest.
											</Trans>
										</p>
									)}
								</div>
							</div>
						</>
					)}
				</div>

				<SheetFooter>
					<Button variant="ghost" disabled={working} onClick={() => onOpenChange(false)}>
						<Trans>Cancel</Trans>
					</Button>
					<Button
						disabled={
							importable.length === 0 ||
							(result?.invalidValues.length ?? 0) > 0 ||
							unmatched > 0 ||
							stagesUnresolved ||
							working
						}
						onClick={() => {
							// The file imports whole or not at all: values that can't be read are fixed first.
							if (!working && !result?.invalidValues.length && unmatched === 0 && !stagesUnresolved)
								importMutation.mutate();
						}}
					>
						{importable.length === 0 ? (
							<Trans>Import</Trans>
						) : (
							<Plural value={importable.length} one="Import # application" other="Import # applications" />
						)}
					</Button>
				</SheetFooter>
			</SheetContent>
		</Sheet>
	);
}
