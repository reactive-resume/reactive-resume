import type { ApplicationLane } from "./lanes";
import type { ApplicationClosedReason, ApplicationStatus } from "@reactive-resume/schema/applications/data";
import type { ApplicationPipeline } from "@reactive-resume/schema/applications/lanes";
import { useLingui } from "@lingui/react/macro";
import { useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { View } from "react-native";
import { applicationError } from "./error";
import { applicationLanesQueryOptions, useApplicationLanes } from "./lane-queries";
import { compatibleReplacements, getLaneLabel } from "./lanes";
import { useInvalidateApplications } from "./queries";
import { CLOSED_REASONS, getClosedReasonLabel, getStageLabel } from "./stages";
import { client } from "@/api/client";
import { getAccountScope, getServer } from "@/auth/session";
import { Banner, Button, Card, IconButton, SelectSheet, Sheet, Text, TextField, useTheme } from "@/ui";

type LaneSettingsProps = { open: boolean; onClose: () => void };

export function LaneSettings({ open, onClose }: LaneSettingsProps) {
	const { t } = useLingui();
	const { space } = useTheme();
	const query = useApplicationLanes();
	const cache = useQueryClient();
	const invalidate = useInvalidateApplications();
	const [editing, setEditing] = useState<ApplicationLane | "new" | null>(null);
	const [retiring, setRetiring] = useState<ApplicationLane | null>(null);
	const [replacement, setReplacement] = useState("");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const lock = useRef(false);
	const run = async (write: (revision: number, scope: string | undefined) => Promise<ApplicationPipeline>) => {
		if (lock.current || !query.data?.supported) return;
		lock.current = true;
		setBusy(true);
		setError(null);
		const server = getServer();
		const scope = getAccountScope();
		try {
			const pipeline = await write(query.data.pipeline.revision, scope ?? undefined);
			cache.setQueryData(applicationLanesQueryOptions(server, scope).queryKey, { supported: true, pipeline });
			if (scope === getAccountScope()) {
				setEditing(null);
				setRetiring(null);
				await invalidate();
			}
		} catch (cause) {
			setError(applicationError(cause));
			await query.refetch();
		} finally {
			lock.current = false;
			setBusy(false);
		}
	};
	const reorder = (index: number, delta: number) => {
		const ids = query.active.map((lane) => lane.id);
		const target = index + delta;
		if (target < 0 || target >= ids.length) return;
		const current = ids[index];
		const neighbor = ids[target];
		if (!current || !neighbor) return;
		ids[index] = neighbor;
		ids[target] = current;
		void run((expectedRevision, scope) =>
			client.applications.lanes.reorder({ ids, expectedRevision }, { context: { scope } }),
		);
	};
	return (
		<Sheet open={open} onClose={onClose} title={t`Manage lanes`} detents={[0.9]}>
			<View style={{ padding: space.s4, gap: space.s3 }}>
				{query.isError && (
					<Banner
						tone="danger"
						message={applicationError(query.error)}
						action={{ label: t`Retry`, onPress: () => void query.refetch() }}
					/>
				)}
				{error && <Banner tone="danger" message={error} />}
				{query.ready && !query.supported && (
					<Banner
						tone="info"
						message={t`Update your server to manage application lanes. Your existing stages still work.`}
					/>
				)}
				{query.supported && (
					<>
						<Text color="ink2">{t`Lanes organize your board. Their category keeps submission, reminders and Insights consistent.`}</Text>
						{editing ? (
							<LaneForm
								key={editing === "new" ? "new" : editing.id}
								lane={editing === "new" ? null : editing}
								busy={busy}
								onCancel={() => setEditing(null)}
								onSave={(draft) =>
									void run((expectedRevision, scope) =>
										editing === "new"
											? client.applications.lanes.create({ ...draft, expectedRevision }, { context: { scope } })
											: client.applications.lanes.update(
													{
														id: editing.id,
														...(draft.label !== getLaneLabel(editing) ? { label: draft.label } : {}),
														color: draft.color,
														expectedRevision,
													},
													{ context: { scope } },
												),
									)
								}
							/>
						) : (
							<>
								<Button
									label={t`Add lane`}
									disabled={busy || query.active.length >= 40}
									onPress={() => {
										setRetiring(null);
										setEditing("new");
									}}
								/>
								{query.active.map((lane, index) => (
									<Card key={lane.id} style={{ gap: space.s2 }}>
										<View style={{ flexDirection: "row", gap: space.s2, alignItems: "center" }}>
											<View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: lane.color }} />
											<Text variant="label" style={{ flex: 1 }}>
												{getLaneLabel(lane)}
											</Text>
											<IconButton
												icon="arrow-up"
												label={t`Move ${getLaneLabel(lane)} up`}
												disabled={busy || index === 0}
												onPress={() => reorder(index, -1)}
											/>
											<IconButton
												icon="arrow-down"
												label={t`Move ${getLaneLabel(lane)} down`}
												disabled={busy || index === query.active.length - 1}
												onPress={() => reorder(index, 1)}
											/>
										</View>
										<Text color="ink3">
											{getStageLabel(lane.category)}
											{lane.closedReason ? ` · ${getClosedReasonLabel(lane.closedReason)}` : ""}
										</Text>
										<View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.s2 }}>
											<Button
												variant="secondary"
												label={t`Rename or change color`}
												disabled={busy}
												onPress={() => {
													setRetiring(null);
													setEditing(lane);
												}}
											/>
											{!lane.systemKey && (
												<Button
													variant="ghost"
													label={t`Retire lane`}
													disabled={busy}
													onPress={() => {
														setRetiring(lane);
														setReplacement("");
													}}
												/>
											)}
										</View>
									</Card>
								))}
							</>
						)}
						{retiring && (
							<Card style={{ gap: space.s3 }}>
								<Text variant="title">{t`Retire ${getLaneLabel(retiring)}?`}</Text>
								<Text color="ink2">{t`Choose a lane with the same category and outcome. Applications move there; their history stays.`}</Text>
								<SelectSheet
									label={t`Replacement lane`}
									value={replacement}
									options={[
										{ value: "", label: t`Choose a replacement` },
										...compatibleReplacements(query.lanes, retiring).map((lane) => ({
											value: lane.id,
											label: getLaneLabel(lane),
										})),
									]}
									onChange={setReplacement}
									disabled={busy}
								/>
								{compatibleReplacements(query.lanes, retiring).length === 0 && (
									<Text color="warnText">{t`Add a compatible replacement lane first.`}</Text>
								)}
								<Button
									label={t`Retire lane`}
									variant="danger"
									loading={busy}
									disabled={!compatibleReplacements(query.lanes, retiring).some((lane) => lane.id === replacement)}
									onPress={() =>
										void run((expectedRevision, scope) =>
											client.applications.lanes.retire(
												{ id: retiring.id, replacementId: replacement, expectedRevision },
												{ context: { scope } },
											),
										)
									}
								/>
								<Button label={t`Cancel`} variant="ghost" disabled={busy} onPress={() => setRetiring(null)} />
							</Card>
						)}
					</>
				)}
			</View>
		</Sheet>
	);
}

type LaneDraft = {
	label: string;
	color: string;
	category: ApplicationStatus;
	closedReason: ApplicationClosedReason | null;
};
type LaneFormProps = {
	lane: ApplicationLane | null;
	busy: boolean;
	onCancel: () => void;
	onSave: (draft: LaneDraft) => void;
};

function LaneForm({ lane, busy, onCancel, onSave }: LaneFormProps) {
	const { t } = useLingui();
	const { space } = useTheme();
	const [label, setLabel] = useState(lane ? getLaneLabel(lane) : "");
	const [color, setColor] = useState(lane?.color ?? "#6366F1");
	const [category, setCategory] = useState<ApplicationStatus>(lane?.category ?? "saved");
	const [reason, setReason] = useState<ApplicationClosedReason | "">(lane?.closedReason ?? "");
	return (
		<Card style={{ gap: space.s3 }}>
			<TextField label={t`Lane name`} value={label} onChangeText={setLabel} maxLength={80} editable={!busy} />
			<TextField
				label={t`Color (#RRGGBB)`}
				value={color}
				onChangeText={setColor}
				maxLength={7}
				autoCapitalize="characters"
				autoCorrect={false}
				editable={!busy}
			/>
			{!lane && (
				<SelectSheet
					label={t`Category`}
					value={category}
					options={(["saved", "applied", "screening", "interview", "offer", "closed"] as const).map((value) => ({
						value,
						label: getStageLabel(value),
					}))}
					onChange={setCategory}
					disabled={busy}
				/>
			)}
			{!lane && category === "closed" && (
				<SelectSheet
					label={t`Preset outcome`}
					value={reason}
					options={[
						{ value: "", label: t`Choose outcome when closing` },
						...CLOSED_REASONS.map((value) => ({ value, label: getClosedReasonLabel(value) })),
					]}
					onChange={setReason}
					disabled={busy}
				/>
			)}
			{!lane && category === "closed" && <Text color="ink2">{t`For a Ghosted lane, choose No response.`}</Text>}
			<Button
				label={t`Save lane`}
				loading={busy}
				disabled={!label.trim() || !/^#[0-9a-f]{6}$/i.test(color)}
				onPress={() =>
					onSave({
						label: label.trim(),
						color,
						category,
						closedReason: category === "closed" && reason ? reason : null,
					})
				}
			/>
			<Button label={t`Cancel`} variant="ghost" disabled={busy} onPress={onCancel} />
		</Card>
	);
}
