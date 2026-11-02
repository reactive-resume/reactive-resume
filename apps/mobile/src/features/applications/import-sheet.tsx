import type { CsvField } from "@reactive-resume/schema/applications/csv";
import { plural } from "@lingui/core/macro";
import { useLingui } from "@lingui/react/macro";
import { useQueryClient } from "@tanstack/react-query";
import { getDocumentAsync } from "expo-document-picker";
import { File } from "expo-file-system";
import { useEffect, useRef, useState } from "react";
import { View } from "react-native";
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
import { applicationLanesQueryOptions, useApplicationLanes } from "./lane-queries";
import { getLaneLabel } from "./lanes";
import { useInvalidateApplications } from "./queries";
import { getClosedReasonLabel, getStageLabel } from "./stages";
import { client } from "@/api/client";
import { getAccountScope, getServer, useSession } from "@/auth/session";
import { shareText } from "@/features/workspace/share";
import { Banner, Button, SelectSheet, Sheet, Text, TextArea, showToast, useTheme } from "@/ui";

type ImportApplicationsSheetProps = { open: boolean; onClose: () => void };
type CsvImportProps = ImportApplicationsSheetProps & { server: string; scope: string | null };
const MAX_IMPORT = 500;
const NEW_LANE = "new";

export function ImportApplicationsSheet(props: ImportApplicationsSheetProps) {
	const session = useSession();
	const scope = getAccountScope();
	if (session.status !== "signed-in") return null;
	return <CsvImport key={`${session.server}:${scope}`} {...props} server={session.server} scope={scope} />;
}

function CsvImport({ open, onClose, server, scope }: CsvImportProps) {
	const { t } = useLingui();
	const { space } = useTheme();
	const query = useApplicationLanes();
	const cache = useQueryClient();
	const invalidate = useInvalidateApplications();
	const [text, setText] = useState("");
	const [overrides, setOverrides] = useState<Record<number, CsvField | null>>({});
	const [laneChoices, setLaneChoices] = useState<Record<string, string>>({});
	const [needsStageRefresh, setNeedsStageRefresh] = useState(false);
	const [busy, setBusy] = useState<"read" | "import" | "share" | "refresh" | null>(null);
	const working = busy !== null;
	const [error, setError] = useState<string | null>(null);
	const active = useRef(true);
	const lock = useRef(false);
	const controller = useRef<AbortController | null>(null);
	useEffect(() => {
		active.current = true;
		return () => {
			active.current = false;
			controller.current?.abort();
		};
	}, []);
	const current = (signal: AbortSignal) =>
		active.current && !signal.aborted && server === getServer() && scope === getAccountScope();
	const changeText = (value: string) => {
		setOverrides({});
		setLaneChoices({});
		setText(value);
	};
	const table = text.trim() ? parseCsv(text) : null;
	const headers = table?.[0] ?? [];
	const mapping = autoMapHeaders(headers).map((field, index) =>
		index in overrides ? (overrides[index] ?? null) : field,
	);
	const result = table ? mapCsvToApplications(table, mapping) : null;
	const importable = result?.rows.slice(0, MAX_IMPORT) ?? [];
	const overflow = (result?.rows.length ?? 0) - importable.length;
	const csvLanes = query.data?.supported ? collectCsvLanes(importable) : [];
	const choiceFor = (lane: (typeof csvLanes)[number]) => laneChoices[lane.key] ?? suggestLane(lane, query.lanes) ?? "";
	const unmatched = csvLanes.filter((lane) => !choiceFor(lane)).length;
	const stagesUnresolved =
		importable.some((row) => row.lane) && ((!query.isSuccess && query.data?.supported !== false) || needsStageRefresh);
	const canImport = importable.length > 0 && !result?.invalidValues.length && !unmatched && !stagesUnresolved;
	const refreshStages = async () => {
		const refreshed = await query.refetch();
		if (active.current && scope === getAccountScope() && refreshed.isSuccess) setNeedsStageRefresh(false);
	};
	const run = async (action: NonNullable<typeof busy>, work: (signal: AbortSignal) => Promise<void>) => {
		if (lock.current || scope !== getAccountScope() || server !== getServer()) return;
		lock.current = true;
		setBusy(action);
		setError(null);
		const request = new AbortController();
		controller.current = request;
		try {
			await work(request.signal);
		} catch {
			if (!current(request.signal)) return;
			if (action === "import") {
				await invalidate();
				if (csvLanes.length) {
					setNeedsStageRefresh(true);
					setLaneChoices((choices) =>
						Object.fromEntries(Object.entries(choices).map(([key, value]) => [key, value === NEW_LANE ? "" : value])),
					);
					await refreshStages();
				}
			}
			if (current(request.signal))
				setError(
					action === "read"
						? t`Couldn't read that file. Choose a .csv file and try again.`
						: action === "share"
							? t`Couldn't share the file. Try again.`
							: t`Import failed. Check the CSV and try again.`,
				);
		} finally {
			lock.current = false;
			if (active.current) setBusy(null);
		}
	};
	const pick = () =>
		void run("read", async (signal) => {
			const picked = await getDocumentAsync({
				type: ["text/csv", "text/comma-separated-values", "application/vnd.ms-excel", "text/plain"],
				copyToCacheDirectory: true,
				multiple: false,
			});
			if (picked.canceled || !picked.assets[0]) return;
			const file = new File(picked.assets[0].uri);
			try {
				if (!current(signal)) return;
				const value = await file.text();
				if (current(signal)) changeText(value);
			} finally {
				file.delete();
			}
		});
	const importRows = () =>
		void run("import", async (signal) => {
			if (!canImport || !current(signal)) return;
			const laneIds = new Map<string, string>();
			const before = new Set(query.lanes.map((lane) => lane.id));
			let expectedRevision = query.data?.pipeline.revision ?? 0;
			for (const lane of csvLanes) {
				if (!current(signal)) return;
				const choice = choiceFor(lane);
				if (choice !== NEW_LANE) {
					laneIds.set(lane.key, choice);
					continue;
				}
				const pipeline = await client.applications.lanes.create(
					{
						expectedRevision,
						label: lane.label,
						category: lane.category,
						closedReason: lane.closedReason,
						color: query.lanes.find((item) => item.systemKey === lane.category)?.color ?? "#6366F1",
					},
					{ signal, context: { scope: scope ?? undefined } },
				);
				if (!current(signal)) return;
				cache.setQueryData(applicationLanesQueryOptions(server, scope).queryKey, { supported: true, pipeline });
				expectedRevision = pipeline.revision;
				const created = pipeline.lanes.find(
					(item) =>
						!before.has(item.id) &&
						item.label === lane.label &&
						item.category === lane.category &&
						item.closedReason === lane.closedReason,
				);
				if (!created) throw new Error("The new application stage was not returned.");
				laneIds.set(lane.key, created.id);
				before.add(created.id);
				setLaneChoices((choices) => ({ ...choices, [lane.key]: created.id }));
			}
			if (!current(signal)) return;
			const saved = await client.applications.import(
				{ items: applyLaneMapping(importable, laneIds) },
				{ signal, context: { scope: scope ?? undefined } },
			);
			if (!current(signal)) return;
			await invalidate();
			if (!current(signal)) return;
			const imported = plural(saved.imported, { one: "Imported # application.", other: "Imported # applications." });
			const skipped = result?.skipped ?? 0;
			showToast({
				message:
					skipped > 0
						? `${imported} ${plural(skipped, { one: "# row had no company or role and was skipped.", other: "# rows had no company or role and were skipped." })}`
						: imported,
			});
			changeText("");
			setNeedsStageRefresh(false);
			onClose();
		});
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
	return (
		<Sheet
			open={open}
			onClose={onClose}
			dismissible={!busy}
			title={t`Import from CSV`}
			footer={
				<View style={{ flexDirection: "row", gap: space.s2 }}>
					<Button label={t`Cancel`} variant="secondary" disabled={working} onPress={onClose} />
					<Button
						label={plural(importable.length, { one: "Import # application", other: "Import # applications" })}
						disabled={working || !canImport}
						loading={busy === "import"}
						onPress={importRows}
					/>
				</View>
			}
		>
			<Text color="ink2">{t`Paste rows or upload a .csv. Columns are matched automatically, and you check the match before anything is saved.`}</Text>
			<View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.s2 }}>
				<Button label={t`Upload .csv`} variant="secondary" disabled={working} onPress={pick} />
				<Button label={t`Use sample`} variant="secondary" disabled={working} onPress={() => changeText(CSV_SAMPLE)} />
			</View>
			{error && <Banner tone="warn" message={error} />}
			{stagesUnresolved && (
				<>
					<Banner tone="warn" message={t`Load your stages before importing named stages. Your CSV data is kept.`} />
					<Button
						label={t`Retry`}
						variant="secondary"
						disabled={working}
						onPress={() => void run("refresh", refreshStages)}
					/>
				</>
			)}
			{result && headers.length > 0 && (
				<View style={{ gap: space.s3 }}>
					<Text accessibilityRole="header" variant="heading">{t`Columns`}</Text>
					{headers.map((header, index) => (
						<SelectSheet
							key={`${header}:${index}`}
							label={t`Column ${header} goes to`}
							value={mapping[index] ?? ""}
							disabled={working}
							options={[
								{ value: "", label: t`Leave out` },
								...CSV_FIELDS.map((field) => ({ value: field, label: fieldLabel(field) })),
							]}
							onChange={(value) =>
								setOverrides((choices) => ({ ...choices, [index]: (value || null) as CsvField | null }))
							}
						/>
					))}
					{csvLanes.length > 0 && (
						<>
							<Text accessibilityRole="header" variant="heading">{t`Stages`}</Text>
							<Text color="ink2">{t`Choose where each stage named in the file goes, or add it as a new stage.`}</Text>
							{csvLanes.map((lane) => (
								<View key={lane.key} style={{ gap: space.s1 }}>
									<Text
										variant="caption"
										color="ink2"
									>{`${getStageLabel(lane.category)}${lane.closedReason ? ` · ${getClosedReasonLabel(lane.closedReason)}` : ""}`}</Text>
									<SelectSheet
										label={t`Stage ${lane.label} goes to`}
										value={choiceFor(lane)}
										disabled={working}
										placeholder={t`Choose a stage`}
										options={[
											...compatibleLanes(lane, query.lanes).map((item) => ({
												value: item.id,
												label: getLaneLabel(item),
											})),
											{ value: NEW_LANE, label: t`Add “${lane.label}” as a new stage` },
										]}
										onChange={(value) => setLaneChoices((choices) => ({ ...choices, [lane.key]: value }))}
									/>
								</View>
							))}
						</>
					)}
					{result.invalidValues.length > 0 && (
						<Banner
							tone="warn"
							message={t`Fix these values in the CSV, or leave their columns out, before importing.`}
						/>
					)}
					{result.invalidValues.map(({ row, field, value }) => (
						<Text key={`${row}:${field}`} color="warnText">
							{t`Row ${row}, ${fieldLabel(field)}: couldn't read “${value}”.`}
						</Text>
					))}
					<Text>
						{plural(importable.length, {
							one: "# application ready to import",
							other: "# applications ready to import",
						})}
					</Text>
					{result.skipped > 0 && (
						<>
							<Text color="ink2">
								{plural(result.skipped, {
									one: "# row has no company or role and will be skipped.",
									other: "# rows have no company or role and will be skipped.",
								})}
							</Text>
							<Button
								label={t`Download them`}
								variant="secondary"
								disabled={working}
								onPress={() =>
									void run("share", async (signal) => {
										if (current(signal))
											await shareText(
												"skipped-applications.csv",
												rowsToCsv(headers, result.skippedRows),
												"text/csv",
												"public.comma-separated-values-text",
											);
									})
								}
							/>
						</>
					)}
					{result.contactsSkipped > 0 && (
						<Text color="ink2">
							{plural(result.contactsSkipped, {
								one: "# contact has an invalid email or no name; its application still imports.",
								other: "# contacts have an invalid email or no name; their applications still import.",
							})}
						</Text>
					)}
					{unmatched > 0 && (
						<Text color="warnText">
							{plural(unmatched, {
								one: "Choose where # stage goes before importing.",
								other: "Choose where # stages go before importing.",
							})}
						</Text>
					)}
					{query.data?.supported === false && importable.some((row) => row.lane) && (
						<Text color="ink2">{t`This server uses the standard stages, so stage names in the file aren't kept.`}</Text>
					)}
					{overflow > 0 && (
						<Text color="warnText">{t`Only the first ${MAX_IMPORT} rows import at once, leaving out ${overflow}. Split the file to import the rest.`}</Text>
					)}
				</View>
			)}
			<TextArea
				label={t`CSV data`}
				value={text}
				minLines={text ? 4 : 6}
				maxLines={text ? 4 : undefined}
				editable={!busy}
				onChangeText={changeText}
				autoCapitalize="none"
				autoCorrect={false}
			/>
		</Sheet>
	);
}
