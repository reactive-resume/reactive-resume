import type { CareerProfileUpdate } from "@reactive-resume/schema/career";
import { t } from "@lingui/core/macro";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useRef, useState } from "react";
import { View } from "react-native";
import { careerProfileUpdateSchema } from "@reactive-resume/schema/career";
import { priorityItems, movePriority } from "./model";
import { ResourceState, useCareerLeaveGuard } from "./shared";
import {
	ensureApproved,
	providerConnection,
	useAIProviders,
	useCareerActions,
	useCareerPreferences,
	useCareerSchedules,
	useDataActions,
	useDataBackend,
	useDocuments,
} from "@/data";
import {
	Button,
	FooterBar,
	Icon,
	IconButton,
	ListRow,
	PushScreen,
	ReorderList,
	type ReorderHandle,
	SectionHeading,
	Switch,
	Text,
	TextField,
	Chip,
	TextLink,
} from "@/ui";

function PreferencesContent() {
	const query = useCareerPreferences();
	const schedules = useCareerSchedules();
	const actions = useDataActions();
	const router = useRouter();
	const { edit } = useLocalSearchParams<{ edit?: string }>();
	const { backend } = useDataBackend();
	const [value, setValue] = useState(() =>
		edit === "roles"
			? (query.data?.targetRoles.join(", ") ?? "")
			: edit === "places"
				? (query.data?.locations.join(", ") ?? "")
				: edit === "work"
					? (query.data?.maxOfficeDays?.toString() ?? "")
					: edit === "pay"
						? (query.data?.minBase.amount?.toString() ?? "")
						: "",
	);
	const [failure, setFailure] = useState<string | null>(null);
	const [saving, setSaving] = useState(false);
	const profile = query.data;
	// Roles: suggestions from your resume, as dashed chips to add (optional AI; S7 asks the first time).
	const career = useCareerActions();
	const providers = useAIProviders();
	const documents = useDocuments({ type: "resume" });
	const [suggested, setSuggested] = useState<string[] | null>(null);
	const suggest = async () => {
		const provider = providers.data?.find((p) => p.isDefault && p.enabled) ?? providers.data?.find((p) => p.enabled);
		if (!provider || !(await ensureApproved("resume-and-facts", providerConnection(provider)))) return;
		try {
			const result = await career.suggestRoles({
				providerId: provider.id,
				recipientVersion: provider.recipientVersion,
				resumeId: documents.data?.find((doc) => doc.type === "resume")?.id ?? null,
				includeKnowledge: true,
				locale: "en-US",
			});
			setSuggested(result.suggestions.map((row) => row.role));
		} catch {
			setFailure(t`Couldn't suggest roles. Try again.`);
		}
	};
	const chosen = value
		.split(",")
		.map((v) => v.trim().toLowerCase())
		.filter(Boolean);
	const discovery = schedules.data?.find((s) => s.kind === "discovery");
	const initialValue =
		edit === "roles"
			? (profile?.targetRoles.join(", ") ?? "")
			: edit === "places"
				? (profile?.locations.join(", ") ?? "")
				: edit === "work"
					? (profile?.maxOfficeDays?.toString() ?? "")
					: edit === "pay"
						? (profile?.minBase.amount?.toString() ?? "")
						: "";
	const guard = useCareerLeaveGuard(!!edit && value !== initialValue);
	const open = (key: string, _initial: string) => {
		setFailure(null);
		router.push({ pathname: "/career/knowledge/preferences", params: { edit: key } });
	};
	const save = async () => {
		if (!profile || saving) return;
		let patch: CareerProfileUpdate = {};
		if (edit === "roles")
			patch = {
				targetRoles: value
					.split(",")
					.map((v) => v.trim())
					.filter(Boolean),
			};
		if (edit === "places")
			patch = {
				locations: value
					.split(",")
					.map((v) => v.trim())
					.filter(Boolean),
			};
		if (edit === "work") patch = { maxOfficeDays: value === "" ? null : Number(value) };
		if (edit === "pay") {
			if (value !== "" && !/^\d+$/.test(value)) {
				setFailure(t`Enter a full amount, such as 95000. Your previous amount is unchanged.`);
				return;
			}
			patch = { minBase: { ...profile.minBase, amount: value === "" ? null : Number(value) } };
		}
		const parsed = careerProfileUpdateSchema.safeParse(patch);
		if (!parsed.success) {
			setFailure(t`Check your entries and try again.`);
			return;
		}
		setSaving(true);
		try {
			await actions.write("profile", "career.updateProfile", parsed.data);
			guard.allowLeave();
			router.back();
		} catch {
			setFailure(t`Couldn't save your preferences. Try again.`);
		} finally {
			setSaving(false);
		}
	};
	if (edit)
		return (
			<PushScreen
				overlay={guard.confirmation}
				title={edit === "roles" ? t`Roles` : edit === "places" ? t`Places` : edit === "work" ? t`Work` : t`Pay`}
				footer={
					<FooterBar>
						<Button
							label={failure === t`Couldn't save your preferences. Try again.` ? t`Retry` : t`Save`}
							block
							tone="primary"
							size="lg"
							disabled={saving}
							onPress={() => void save()}
						/>
					</FooterBar>
				}
			>
				<View style={{ padding: 24, gap: 20 }}>
					<TextField
						label={
							edit === "roles"
								? t`Target roles, separated by commas`
								: edit === "places"
									? t`Places, separated by commas`
									: edit === "work"
										? t`Maximum office days a week`
										: t`Minimum base salary`
						}
						value={value}
						onChangeText={setValue}
						keyboardType={edit === "pay" || edit === "work" ? "number-pad" : "default"}
					/>
					{edit === "roles" ? (
						suggested && suggested.every((role) => chosen.includes(role.toLowerCase())) ? (
							<Text variant="ui" color="ink3">{t`You already have every role your resume suggests.`}</Text>
						) : suggested ? (
							<View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
								{suggested
									.filter((role) => !chosen.includes(role.toLowerCase()))
									.map((role) => (
										<Chip
											key={role}
											label={role}
											icon="plus"
											dashed
											testID={`role-${role}`}
											onPress={() => setValue((current) => [current.trim(), role].filter(Boolean).join(", "))}
										/>
									))}
							</View>
						) : (
							<TextLink label={t`Suggest roles from my resume`} icon="sparkle" onPress={() => void suggest()} />
						)
					) : null}
					{edit === "pay" ? (
						<>
							<Text variant="body">
								{profile?.minBase.currency} · {profile?.minBase.period}
							</Text>
							<Button label={t`Don't use pay to filter`} onPress={() => setValue("")} />
						</>
					) : null}
					{failure ? (
						<Text variant="body" color="dangerText">
							{failure}
						</Text>
					) : null}
				</View>
			</PushScreen>
		);
	return (
		<PushScreen title={t`Job search`} subtitle={t`Used to find new roles and to judge fit.`}>
			<ResourceState pending={query.isPending} error={query.isError} retry={() => void query.refetch()}>
				{profile ? (
					<>
						<View style={{ marginTop: 20 }}>
							<ListRow
								top
								title={t`Roles`}
								secondary={profile.targetRoles.join(", ")}
								trailing="caret"
								onPress={() => open("roles", profile.targetRoles.join(", "))}
							/>
							<ListRow
								title={t`Places`}
								secondary={profile.locations.join(" · ")}
								trailing="caret"
								onPress={() => open("places", profile.locations.join(", "))}
							/>
							<ListRow
								title={t`Work`}
								secondary={
									profile.maxOfficeDays === null
										? t`Hybrid or remote`
										: t`At most ${profile.maxOfficeDays} office days a week`
								}
								trailing="caret"
								onPress={() => open("work", profile.maxOfficeDays?.toString() ?? "")}
							/>
							<ListRow
								title={t`Pay`}
								secondary={
									profile.minBase.amount === null
										? t`Don't use pay to filter`
										: t`From ${new Intl.NumberFormat("en", { style: "currency", currency: profile.minBase.currency, maximumFractionDigits: 0 }).format(profile.minBase.amount)} a ${profile.minBase.period}`
								}
								trailing="caret"
								onPress={() => open("pay", profile.minBase.amount?.toString() ?? "")}
							/>
							{backend.kind === "fake" ? (
								// The profile has no field for industries to avoid yet; the storyboard draws one.
								<ListRow title={t`Avoid`} secondary={t`Gambling, defence`} trailing="caret" />
							) : null}
							<ListRow
								title={t`Priorities`}
								secondary={profile.priorities}
								last
								boxHidden
								trailing="caret"
								onPress={() => router.push("/career/knowledge/priorities")}
							/>
						</View>
						<SectionHeading title={t`Discovery`} />
						<ListRow
							title={t`Find new roles for me`}
							secondary={
								backend.kind === "fake"
									? t`07:00 Berlin · Work OpenAI · may charge`
									: t`Uses this server's web-search connection`
							}
							trailing={<Switch value={!!discovery?.enabled} interactive={false} />}
							onPress={() => router.push(`/career/schedules/${discovery?.id ?? "new"}`)}
						/>
						<ListRow
							title={t`Where to look`}
							secondary={backend.kind === "fake" ? t`Job boards and 12 company sites` : profile.locations.join(" · ")}
							trailing="caret"
							last
							onPress={() => router.push(`/career/schedules/${discovery?.id ?? "new"}`)}
						/>
					</>
				) : null}
			</ResourceState>
		</PushScreen>
	);
}

export function PrioritiesScreen() {
	const query = useCareerPreferences();
	return (
		<PushScreen title={t`Priorities`} subtitle={t`Put what matters most first.`}>
			<ResourceState pending={query.isPending} error={query.isError} retry={() => void query.refetch()}>
				{query.data ? <PrioritiesEditor initial={query.data.priorities} /> : null}
			</ResourceState>
		</PushScreen>
	);
}
type PrioritiesEditorProps = { initial: string };
function PrioritiesEditor({ initial }: PrioritiesEditorProps) {
	const [items, setItems] = useState(() => priorityItems(initial).map((text, index) => ({ id: String(index), text })));
	const [failed, setFailed] = useState(false);
	const actions = useDataActions();
	const ref = useRef<ReorderHandle>(null);
	const [selected, setSelected] = useState<string | null>(null);
	const reorder = (from: number, to: number) => {
		const next = movePriority(items, from, to);
		setItems(next);
		void actions
			.write("profile", "career.updateProfile", { priorities: next.map((item) => item.text).join(", then ") })
			.then(() => setFailed(false))
			.catch(() => setFailed(true));
	};
	return (
		<>
			{failed ? (
				<View style={{ padding: 24 }}>
					<Text variant="body" color="dangerText">{t`Couldn't save your preferences. Try again.`}</Text>
					<Button
						label={t`Retry`}
						onPress={() =>
							void actions
								.flush()
								.then(() => setFailed(false))
								.catch(() => setFailed(true))
						}
					/>
				</View>
			) : null}
			<ReorderList
				ref={ref}
				data={items}
				keyOf={(item) => item.id}
				label={(item) => item.text}
				itemHeight={64}
				onReorder={reorder}
				renderItem={(item, { handle }) => (
					<ListRow
						title={item.text}
						leading={handle(
							<View style={{ width: 24, height: 48, justifyContent: "center" }}>
								<Icon name="dots-six-vertical" />
							</View>,
						)}
						trailing={
							<IconButton icon="dots-three" label={t`Actions for ${item.text}`} onPress={() => setSelected(item.id)} />
						}
					/>
				)}
			/>
			{selected ? (
				<View style={{ padding: 24, gap: 20 }}>
					<Button
						label={t`Move up`}
						disabled={items.findIndex((item) => item.id === selected) === 0}
						onPress={() => ref.current?.moveBy(selected, -1)}
					/>
					<Button
						label={t`Move down`}
						disabled={items.findIndex((item) => item.id === selected) === items.length - 1}
						onPress={() => ref.current?.moveBy(selected, 1)}
					/>
				</View>
			) : null}
		</>
	);
}

export function PreferencesScreen() {
	const query = useCareerPreferences();
	const { edit } = useLocalSearchParams<{ edit?: string }>();
	return query.data ? (
		<PreferencesContent key={edit ?? "list"} />
	) : (
		<PushScreen title={t`Job search`}>
			<ResourceState pending={query.isPending} error={query.isError} retry={() => void query.refetch()}>
				{null}
			</ResourceState>
		</PushScreen>
	);
}
