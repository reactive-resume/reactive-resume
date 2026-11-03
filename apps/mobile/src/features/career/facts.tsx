import type { Fact } from "./hooks";
import type { RouterInput } from "@/api/client";
import type { ReactNode } from "react";
import { AnimatedLegendList } from "@legendapp/list/reanimated";
import { plural } from "@lingui/core/macro";
import { useLingui } from "@lingui/react/macro";
import { useQuery } from "@tanstack/react-query";
import * as Crypto from "expo-crypto";
import { memo, useCallback, useDeferredValue, useLayoutEffect, useMemo, useRef, useState } from "react";
import { RefreshControl, View } from "react-native";
import Animated from "react-native-reanimated";
import { factCategorySchema } from "@reactive-resume/schema/career";
import { categoryLabel, factCategories } from "./fact-categories";
import { client, prepareRpc, useCareerAction, useCareerQueries, useCareerTime, useUndoRows } from "./hooks";
import { ResumeFacts } from "./resume-facts";
import { Actions, EditorSheet, LoadState, SwitchRow } from "./shared";
import { orpc } from "@/api/client";
import { getAccountScope, getServer, useSession } from "@/auth/session";
import { useApplications } from "@/features/applications/queries";
import {
	Banner,
	Button,
	Card,
	Chip,
	EmptyState,
	SelectSheet,
	Sheet,
	Text,
	TextArea,
	TextField,
	listItemMotion,
	listLayout,
	useFirstAppearance,
	useReducedMotion,
	useTheme,
} from "@/ui";
import { usePullRefresh } from "@/ui/use-pull-refresh";

type FactsProps = {
	/** The Knowledge intro and tab switch, scrolled with the list as its header. */
	children?: ReactNode;
	onRefresh: () => Promise<unknown>;
};

type RowActions = {
	onToggle: (fact: Fact, active: boolean) => void;
	onShare: (fact: Fact) => void;
	onSource: (fact: Fact) => void;
	onCorrect: (fact: Fact) => void;
	onForget: (fact: Fact) => void;
};

const keyOf = (fact: Fact) => fact.id;

export function Facts({ children, onRefresh }: FactsProps) {
	const { t } = useLingui();
	const { colors, size, space } = useTheme();
	const { facts, profile } = useCareerQueries();
	const pull = usePullRefresh(onRefresh);
	const [search, setSearch] = useState("");
	// Typing stays responsive; the list filters in a deferred render.
	const query = useDeferredValue(search).trim().toLocaleLowerCase();
	const [category, setCategory] = useState("all");
	const [editor, setEditor] = useState<{ fact: Fact | null } | null>(null);
	const [source, setSource] = useState<Fact | null>(null);
	const [showForgotten, setShowForgotten] = useState(false);
	const undo = useUndoRows();
	const action = useCareerAction();
	const memory = useCareerAction();
	const session = useSession();
	const busy = useRef(new Set<string>());
	const [updating, setUpdating] = useState<string[]>([]);
	const [failed, setFailed] = useState(false);
	const updateFact = async (input: RouterInput["career"]["updateFact"]) => {
		if (session.status !== "signed-in" || getServer() !== session.server || busy.current.has(input.id)) return;
		busy.current.add(input.id);
		setUpdating([...busy.current]);
		setFailed(false);
		try {
			await client.career.updateFact(input);
		} catch {
			setFailed(true);
		} finally {
			busy.current.delete(input.id);
			setUpdating([...busy.current]);
			void action.refresh();
		}
	};
	const { when, profile: account } = useCareerTime();
	const rows = useMemo(
		() =>
			(facts.data ?? []).filter(
				(fact) =>
					!undo.hidden.includes(fact.id) &&
					(category === "all" || fact.category === category) &&
					`${fact.text} ${fact.source.quote} ${fact.company ?? ""}`.toLocaleLowerCase().includes(query),
			),
		[facts.data, undo.hidden, category, query],
	);
	const firstAppearance = useFirstAppearance(!facts.isPending);

	// Rows get one set of callbacks for the screen's life, so a change re-renders only the row it touches.
	const forgotten = t`Fact forgotten`;
	const latest = useRef({ updateFact, remove: undo.remove, forgotten });
	useLayoutEffect(() => {
		latest.current = { updateFact, remove: undo.remove, forgotten };
	});
	const [actions] = useState<RowActions>(() => ({
		onToggle: (fact, active) => void latest.current.updateFact({ id: fact.id, status: active ? "active" : "excluded" }),
		onShare: (fact) => void latest.current.updateFact({ id: fact.id, share: true }),
		onSource: setSource,
		onCorrect: (fact) => setEditor({ fact }),
		onForget: (fact) =>
			latest.current.remove(
				fact.id,
				latest.current.forgotten,
				() => prepareRpc(client.career.forgetFact, { id: fact.id }),
				orpc.career.facts.key(),
			),
	}));
	const renderItem = useCallback(
		({ item, index }: { item: Fact; index: number }) => (
			<FactRow
				fact={item}
				index={index}
				first={firstAppearance}
				pending={updating.includes(item.id)}
				actions={actions}
			/>
		),
		[firstAppearance, updating, actions],
	);

	const header = (
		<View
			style={{
				gap: space.s4,
				paddingBottom: space.s4,
				width: "100%",
				maxWidth: size.formSheet - space.s4 * 2,
				alignSelf: "center",
			}}
		>
			{children}
			<LoadState query={profile} />
			{profile.data ? (
				<>
					<SelectSheet
						label={t`Remember facts from my messages`}
						value={profile.data.memoryMode}
						disabled={memory.pending || !account.data?.id}
						onChange={(memoryMode) => {
							if (!account.data?.id) return;
							const scope = JSON.stringify([session.server, account.data.id]);
							void memory.run(() => client.career.updateProfile({ memoryMode }, { context: { scope } }));
						}}
						options={[
							{ value: "ask", label: t`Ask first` },
							{ value: "auto", label: t`Automatically` },
							{ value: "off", label: t`Never` },
						]}
					/>
					<Text color="ink3">
						{profile.data.memoryMode === "ask"
							? t`The coach proposes each fact in the chat. Nothing is saved until you agree.`
							: profile.data.memoryMode === "auto"
								? t`The coach saves facts you state, and tells you. You can undo.`
								: t`The coach doesn't remember anything from your messages.`}
					</Text>
				</>
			) : null}
			{memory.error ? <Banner tone="danger" message={memory.error} /> : null}
			<TextField label={t`Search facts`} value={search} onChangeText={setSearch} />
			<SelectSheet
				label={t`Type`}
				value={category}
				onChange={setCategory}
				options={[{ value: "all", label: t`All` }, ...factCategories()]}
			/>
			<ResumeFacts />
			{facts.data?.length ? <Button label={t`Add a fact`} onPress={() => setEditor({ fact: null })} /> : null}
			<SwitchRow label={t`Show forgotten`} value={showForgotten} onValueChange={setShowForgotten} />
			{showForgotten ? <ForgottenFacts /> : null}
			<LoadState query={facts} />
			{failed ? (
				<Banner tone="danger" message={t`Couldn't save that change. Check your connection and try again.`} />
			) : null}
			{!facts.isPending && !facts.isError && !rows.length ? (
				<EmptyState
					variant={facts.data?.length ? "compact" : "card"}
					title={!facts.data?.length ? t`No facts yet` : t`No facts match`}
					message={
						!facts.data?.length
							? t`Add things you've done, with numbers when you have them, such as “Cut checkout errors by 30% in 2025”. The coach backs its answers and your stories with them.`
							: t`Try another word or type.`
					}
					action={
						!facts.data?.length
							? { label: t`Add a fact`, onPress: () => setEditor({ fact: null }) }
							: category !== "all"
								? { label: t`Show all types`, onPress: () => setCategory("all") }
								: undefined
					}
				/>
			) : null}
		</View>
	);

	return (
		<>
			<AnimatedLegendList
				data={rows}
				keyExtractor={keyOf}
				renderItem={renderItem}
				extraData={updating}
				ListHeaderComponent={header}
				refreshControl={<RefreshControl {...pull} tintColor={colors.accent} colors={[colors.accent]} />}
				contentInsetAdjustmentBehavior="automatic"
				alwaysBounceVertical
				itemLayoutAnimation={listLayout}
				style={{ flex: 1 }}
				contentContainerStyle={{ paddingHorizontal: space.s4, paddingTop: space.s4 }}
			/>
			{editor ? <FactEditor key={editor.fact?.id ?? "new"} fact={editor.fact} onClose={() => setEditor(null)} /> : null}
			<Sheet open={!!source} onClose={() => setSource(null)} title={t`Source and correction history`} detents={[0.75]}>
				<View style={{ padding: space.s4, gap: space.s3 }}>
					{source ? (
						<>
							<Text variant="title">{source.text}</Text>
							<Text color="ink3">
								{source.source.kind === "manual"
									? t`Added by you`
									: source.source.kind === "resume" || source.source.kind === "resume-version"
										? t`Resume`
										: source.source.kind === "letter" || source.source.kind === "letter-version"
											? t`Cover letter`
											: source.source.kind === "debrief"
												? t`Debrief`
												: source.source.kind === "attachment"
													? t`Attachment`
													: t`Message`}
							</Text>
							<Text selectable>{source.source.quote || t`No source quote recorded.`}</Text>
							<Text color="ink3">{t`Forgetting unlinks this fact from stories and saved items. The original source stays unchanged.`}</Text>
							{source.revisions.map((revision, index) => (
								<View key={index}>
									<Text variant="caption" color="ink3">
										{when(revision.at)}
									</Text>
									<Text>{revision.text}</Text>
								</View>
							))}
						</>
					) : null}
					<Button variant="ghost" label={t`Close`} onPress={() => setSource(null)} />
				</View>
			</Sheet>
		</>
	);
}

function ForgottenFacts() {
	const { t } = useLingui();
	const session = useSession();
	const scope = getAccountScope();
	const { when } = useCareerTime();
	const history = useQuery({
		...orpc.career.forgottenFacts.queryOptions({ input: {}, context: { scope: scope ?? undefined } }),
		queryKey: [...orpc.career.forgottenFacts.key(), session.server, scope],
		enabled: session.status === "signed-in",
		retry: false,
	});
	return (
		<Card>
			<LoadState query={history} />
			{history.data?.length === 0 ? <Text color="ink3">{t`No forgotten facts`}</Text> : null}
			{history.data?.map(({ count, at }) => (
				<Text key={at.toISOString()} color="ink3">
					{plural(count, { one: "# fact forgotten", other: "# facts forgotten" })} · {when(at)}
				</Text>
			))}
		</Card>
	);
}

type FactRowProps = { fact: Fact; index: number; first: boolean; pending: boolean; actions: RowActions };

// Memoized: the app has no React Compiler, and typing or one toggle shouldn't re-render every card.
const FactRow = memo(function FactRow({ fact, index, first, pending, actions }: FactRowProps) {
	const reduced = useReducedMotion();
	const { t } = useLingui();
	const { size, space } = useTheme();
	return (
		<Animated.View
			{...listItemMotion(index, first, { reduced })}
			style={{
				paddingBottom: space.s4,
				width: "100%",
				maxWidth: size.formSheet - space.s4 * 2,
				alignSelf: "center",
			}}
		>
			<Card style={{ gap: space.s3 }}>
				<Actions>
					<Chip label={categoryLabel(fact.category)} />
					<Chip label={fact.company ? t`${fact.company} only` : t`All applications`} />
				</Actions>
				<Text>{fact.text}</Text>
				<Text variant="callout" color="ink3">
					{fact.usedBy.stories + fact.usedBy.savedItems === 0
						? t`Not used in a story or saved item yet`
						: `${plural(fact.usedBy.stories, { one: "Backs # story", other: "Backs # stories" })} · ${plural(fact.usedBy.savedItems, { one: "used in # saved item", other: "used in # saved items" })}`}
				</Text>
				<SwitchRow
					label={t`Use this fact`}
					value={fact.status === "active"}
					disabled={pending}
					onValueChange={(active) => actions.onToggle(fact, active)}
				/>
				<Actions>
					<Button variant="ghost" label={t`View source`} onPress={() => actions.onSource(fact)} />
					<Button variant="ghost" label={t`Correct`} onPress={() => actions.onCorrect(fact)} />
					{fact.applicationId ? (
						<Button
							variant="ghost"
							label={t`Use for all applications`}
							disabled={pending}
							onPress={() => actions.onShare(fact)}
						/>
					) : null}
					<Button variant="ghost" label={t`Forget`} onPress={() => actions.onForget(fact)} />
				</Actions>
			</Card>
		</Animated.View>
	);
});

type FactEditorProps = { fact: Fact | null; onClose: () => void };
function FactEditor({ fact, onClose }: FactEditorProps) {
	const { t } = useLingui();
	const { space } = useTheme();
	const [scope] = useState(getAccountScope);
	const [before] = useState(() =>
		fact ? { text: fact.text, category: fact.category, applicationId: fact.applicationId } : null,
	);
	const [text, setText] = useState(fact?.text ?? "");
	const [category, setCategory] = useState(fact?.category ?? "accomplishment");
	const [applicationId, setApplicationId] = useState(fact?.applicationId ?? "");
	const applications = useApplications(!!fact);
	const action = useCareerAction();
	const dirty =
		text.trim() !== (before?.text ?? "") ||
		category !== (before?.category ?? "accomplishment") ||
		(applicationId || null) !== (before?.applicationId ?? null);
	return (
		<EditorSheet
			dirty={dirty}
			pending={action.pending}
			onClose={onClose}
			title={fact ? t`Correct fact` : t`Add a fact`}
		>
			<View style={{ padding: space.s4, gap: space.s4 }}>
				<TextArea label={t`Fact`} value={text} maxLength={2000} onChangeText={setText} editable={!action.pending} />
				<SelectSheet
					label={t`Type`}
					value={category}
					onChange={setCategory}
					disabled={action.pending}
					options={[
						...(before && !factCategorySchema.safeParse(before.category).success
							? [{ value: before.category, label: before.category }]
							: []),
						...factCategories(),
					]}
				/>
				{fact ? (
					<>
						<SelectSheet
							label={t`Scope`}
							value={applicationId}
							onChange={setApplicationId}
							disabled={action.pending || !applications.data}
							options={[
								{ value: "", label: t`All applications` },
								...(before?.applicationId &&
								!applications.data?.some((application) => application.id === before.applicationId)
									? [{ value: before.applicationId, label: fact.company ?? t`Application` }]
									: []),
								...(applications.data ?? []).map((application) => ({
									value: application.id,
									label: `${application.company} · ${application.role}`,
								})),
							]}
						/>
						<LoadState query={applications} />
						<Text color="ink3">{t`The original stays in correction history. Stories using it will need review.`}</Text>
					</>
				) : null}
				{action.error ? <Banner tone="danger" message={action.error} /> : null}
				<Button
					label={t`Save fact`}
					loading={action.pending}
					disabled={!text.trim() || !dirty}
					onPress={() => {
						void action.run(async () => {
							if (fact && before)
								await client.career.correctFact(
									{
										id: fact.id,
										before,
										...(text.trim() !== before.text ? { text: text.trim() } : {}),
										...(category !== before.category ? { category: factCategorySchema.parse(category) } : {}),
										...((applicationId || null) !== before.applicationId
											? { applicationId: applicationId || null }
											: {}),
									},
									{ context: { scope: scope ?? undefined } },
								);
							else
								await client.career.saveFact(
									{
										text: text.trim(),
										category: factCategorySchema.parse(category),
										applicationId: null,
										source: { kind: "manual", id: Crypto.randomUUID(), quote: text.trim() },
									},
									{ context: { scope: scope ?? undefined } },
								);
						}, onClose);
					}}
				/>
			</View>
		</EditorSheet>
	);
}
