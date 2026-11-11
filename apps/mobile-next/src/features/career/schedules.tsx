import type { RouterOutput } from "@/api/client";
import { t } from "@lingui/core/macro";
import DateTimePicker from "@react-native-community/datetimepicker";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import { ResourceState } from "./shared";
import {
	providerConnection,
	recurringApprovalChanged,
	recurringWorkStatus,
	saveApprovedSchedule,
	useAIProviders,
	useCareerSchedules,
	useDataBackend,
	useSettings,
} from "@/data";
import { now, timeZone, wallTimeChoices, zonedParts } from "@/data/clock";
import {
	BottomSheet,
	Button,
	FooterBar,
	ListRow,
	PushScreen,
	Segmented,
	SheetScreen,
	Switch,
	Text,
	haptic,
} from "@/ui";

export function SchedulesScreen() {
	const query = useCareerSchedules();
	const router = useRouter();
	return (
		<PushScreen title={t`Routines`}>
			<ResourceState pending={query.isPending} error={query.isError} retry={() => void query.refetch()}>
				{query.data?.length ? (
					query.data.map((s, i) => (
						<ListRow
							key={s.id}
							title={
								s.kind === "discovery"
									? t`Discovery`
									: s.kind === "prepare"
										? t`Interview preparation`
										: t`Follow-up reminder`
							}
							secondary={s.enabled ? s.timezone : t`Paused`}
							trailing="caret"
							last={i === query.data.length - 1}
							onPress={() => router.push(`/career/schedules/${s.id}`)}
						/>
					))
				) : (
					<View style={{ padding: 24 }}>
						<Text variant="body">{t`No schedules yet`}</Text>
					</View>
				)}
			</ResourceState>
		</PushScreen>
	);
}
export function ScheduleScreen() {
	const { id } = useLocalSearchParams<{ id: string }>();
	const query = useCareerSchedules();
	const schedule = query.data?.find((s) => s.id === id);
	return schedule ? (
		<ScheduleEditor key={schedule.id} schedule={schedule} />
	) : (
		<SheetScreen title={t`Schedule`} height={640}>
			<ResourceState pending={query.isPending} error={query.isError} retry={() => void query.refetch()}>
				<View style={{ padding: 24 }}>
					<Text variant="body">{t`Scheduled work is not available on this server. Ask your server administrator to configure it.`}</Text>
				</View>
			</ResourceState>
		</SheetScreen>
	);
}
type ScheduleEditorProps = { schedule: RouterOutput["career"]["schedules"][number] };
function ScheduleEditor({ schedule }: ScheduleEditorProps) {
	const router = useRouter();
	const providers = useAIProviders();
	const settings = useSettings();
	const { backend } = useDataBackend();
	const fake = backend.kind === "fake";
	const [providerId, setProviderId] = useState(schedule.aiProviderId);
	const [choosingProvider, setChoosingProvider] = useState(false);
	const provider = providers.data?.find((p) => p.id === providerId && p.enabled);
	const connection = provider ? providerConnection(provider) : null;
	// Paused when the connection changed since this schedule was approved; the server may also have switched it off.
	const paused =
		!!connection &&
		(schedule.enabled
			? recurringWorkStatus(schedule.id, connection) === "paused"
			: recurringApprovalChanged(schedule.id, connection));
	const [frequency, setFrequency] = useState(schedule.intervalDays === 7 ? "weekly" : "daily");
	const [instant, setInstant] = useState(new Date(schedule.nextRunAt));
	// Review and resume turns a paused schedule back on.
	const [enabled, setEnabled] = useState(schedule.enabled || paused);
	const [notify, setNotify] = useState(settings.data?.notificationCategories.newRoles !== false);
	const [picker, setPicker] = useState(false);
	const [pause, setPause] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [saving, setSaving] = useState(false);
	const [pauseDays, setPauseDays] = useState(0);
	const zone = schedule.timezone;
	const local = zonedParts(instant, zone);
	const here = zonedParts(instant, timeZone());
	const discoveryLive = schedule.kind === "discovery" && !fake;
	const dirty =
		providerId !== schedule.aiProviderId ||
		enabled !== schedule.enabled ||
		instant.getTime() !== new Date(schedule.nextRunAt).getTime() ||
		frequency !== (schedule.intervalDays === 7 ? "weekly" : "daily");
	const save = async () => {
		if (!connection || saving || discoveryLive) return;
		setSaving(true);
		setError(null);
		try {
			await saveApprovedSchedule(
				{
					id: schedule.id,
					kind: schedule.kind === "prepare" ? "prepare" : schedule.kind === "follow-up" ? "follow-up" : "discovery",
					query: schedule.query ?? "",
					applicationId: schedule.applicationId,
					interviewId: schedule.interviewId,
					lead: schedule.lead === "24h" || schedule.lead === "2h" || schedule.lead === "morning" ? schedule.lead : null,
					enabled,
					timezone: zone,
					nextRunAt: instant,
					intervalDays: frequency === "weekly" ? 7 : 1,
					aiProviderId: provider?.id ?? null,
					email: schedule.email,
				},
				connection,
			);
			await settings.save({ notificationCategories: { ...settings.data?.notificationCategories, newRoles: notify } });
			haptic("success");
			router.back();
		} catch {
			setError(t`Couldn't save this schedule. Try again.`);
			haptic("error");
		} finally {
			setSaving(false);
		}
	};
	return (
		<>
			<SheetScreen
				title={
					schedule.kind === "discovery"
						? t`Discovery`
						: schedule.kind === "prepare"
							? t`Interview preparation`
							: t`Follow-up reminder`
				}
				height={640}
				closeIconSize={24}
				keyboard
				dirty={dirty}
				footer={
					<FooterBar bg="raised" divider={false} inset={false}>
						<Button
							label={paused ? t`Review and resume` : t`Save`}
							grow
							size="lg"
							tone="primary"
							disabled={!connection || saving || discoveryLive || frequency === "weekdays"}
							onPress={() => void save()}
						/>
					</FooterBar>
				}
			>
				<View style={{ paddingHorizontal: 24 }}>
					<Text variant="body" color="ink3">
						{schedule.kind === "discovery"
							? t`Finds new roles that match your job search.`
							: t`Prepare for your next interview.`}
					</Text>
				</View>
				<View style={{ marginHorizontal: 24, marginTop: 20 }}>
					<Segmented
						value={frequency}
						onChange={setFrequency}
						options={[
							{ key: "daily", label: t`Daily` },
							{ key: "weekdays", label: t`Weekdays` },
							{ key: "weekly", label: t`Weekly` },
						]}
					/>
				</View>
				<View style={{ marginTop: 12 }}>
					<ListRow
						title={t`Time`}
						value={`${local.time} ${zone.split("/").at(-1)}`}
						trailing="caret"
						onPress={() => setPicker(true)}
					/>
					<ListRow
						title={t`Notify me when it finds roles`}
						trailing={
							<Switch value={notify} onValueChange={setNotify} accessibilityLabel={t`Notify me when it finds roles`} />
						}
					/>
					<ListRow
						title={t`Pause`}
						value={!enabled ? t`Until I turn it back on` : pauseDays ? t`${pauseDays} days` : t`Not paused`}
						accessibilityLabel={`${t`Pause`}, ${!enabled ? t`Until I turn it back on` : pauseDays ? t`${pauseDays} days` : t`Not paused`}`}
						trailing="caret"
						onPress={() => setPause(true)}
					/>
					<ListRow
						title={
							discoveryLive ? t`Runs with this server's web-search connection` : t`Runs with ${provider?.label ?? "—"}`
						}
						secondary={t`Your provider may charge for each run`}
						last
						// The board's last row (no divider) registers no ListRow box of its own.
						boxHidden
						trailing="caret"
						onPress={() => setChoosingProvider(true)}
					/>
				</View>
				<View style={{ paddingHorizontal: 24, paddingTop: 8 }}>
					<Text variant="ui" color="ink3">
						{discoveryLive
							? t`Discovery uses the web-search connection configured by your server administrator.`
							: schedule.kind === "prepare"
								? t`Each run sends your interview, application, resume and Knowledge to ${connection ? new URL(connection.host).host : "—"} with your key.`
								: t`Each run sends your target roles, places and pay to ${connection ? new URL(connection.host).host : "—"} with your key.`}
					</Text>
				</View>
				{paused ? (
					<Text
						variant="body"
						color="dangerText"
						style={{ paddingHorizontal: 24 }}
						testID="schedule-paused"
					>{t`Paused: your AI connection changed`}</Text>
				) : null}
				{!connection ? (
					<Text
						variant="body"
						color="dangerText"
						style={{ paddingHorizontal: 24 }}
					>{t`Its connection is unavailable. Choose and approve a connection before enabling this schedule.`}</Text>
				) : null}
				{timeZone() !== zone ? (
					<Text
						variant="body"
						style={{ paddingHorizontal: 24 }}
					>{t`Next run: ${local.date} ${local.time} ${zone} · ${here.time} here`}</Text>
				) : null}
				{error ? (
					<Text variant="body" color="dangerText" style={{ paddingHorizontal: 24 }}>
						{error}
					</Text>
				) : null}
				{picker ? (
					<DateTimePicker
						value={instant}
						mode="time"
						timeZoneName={zone}
						onChange={(_event, date) => {
							setPicker(false);
							if (!date) return;
							const parts = zonedParts(date, zone);
							const choices = wallTimeChoices(local.date, parts.time, zone);
							if (choices.length !== 1) {
								setError(t`Choose an unambiguous time in this timezone.`);
								return;
							}
							if (choices[0]) setInstant(choices[0].instant);
						}}
					/>
				) : null}
			</SheetScreen>
			{pause ? (
				<BottomSheet title={t`Pause`} height={360} onClose={() => setPause(false)}>
					<ListRow
						title={t`Resume`}
						onPress={() => {
							setEnabled(true);
							setPauseDays(0);
							setPause(false);
						}}
					/>
					{[7, 14, 0].map((days) => (
						<ListRow
							key={days}
							title={days === 0 ? t`Until I turn it back on` : days === 7 ? t`1 week` : t`2 weeks`}
							onPress={() => {
								setPauseDays(days);
								setEnabled(days > 0);
								if (days > 0) {
									const date = new Date(`${zonedParts(now(), zone).date}T00:00:00Z`);
									date.setUTCDate(date.getUTCDate() + days);
									const choice = wallTimeChoices(date.toISOString().slice(0, 10), local.time, zone);
									if (choice.length === 1 && choice[0]) setInstant(choice[0].instant);
								}
								setPause(false);
							}}
						/>
					))}
				</BottomSheet>
			) : null}
			{choosingProvider ? (
				<BottomSheet title={t`AI connection`} height={400} onClose={() => setChoosingProvider(false)}>
					{providers.data
						?.filter((p) => p.enabled)
						.map((p) => (
							<ListRow
								key={p.id}
								title={p.label}
								secondary={new URL(providerConnection(p).host).host}
								onPress={() => {
									setProviderId(p.id);
									setChoosingProvider(false);
								}}
							/>
						))}
				</BottomSheet>
			) : null}
		</>
	);
}
