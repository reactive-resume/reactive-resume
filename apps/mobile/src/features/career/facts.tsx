import { t } from "@lingui/core/macro";
import { useFocusEffect } from "expo-router";
import { useCallback, useRef, useState } from "react";
import { View } from "react-native";
import { createForgetHold } from "./forget-hold";
import { factSourceLine } from "./model";
import { ResourceState } from "./shared";
import { screenTexts, useCareerFacts, useCareerActions, useForgottenFacts, useDataBackend, useDocuments } from "@/data";
import {
	BottomSheet,
	Button,
	FooterBar,
	IconButton,
	ListRow,
	PushScreen,
	SectionHeading,
	Segmented,
	Text,
	TextField,
	haptic,
	showToast,
} from "@/ui";

export function FactsScreen() {
	const { scope } = useDataBackend();
	return <ScopedFactsScreen key={scope} />;
}

function ScopedFactsScreen() {
	const query = useCareerFacts({ all: true });
	const actions = useCareerActions();
	const forgotten = useForgottenFacts();
	const visible = useRef(false);
	const [hold] = useState(() =>
		createForgetHold<NonNullable<typeof query.data>[number]>((fact) => actions.forgetFact({ id: fact.id })),
	);
	const [held, setHeld] = useState(hold.values());
	const [showForgotten, setShowForgotten] = useState(false);
	useFocusEffect(
		useCallback(() => {
			visible.current = true;
			setHeld(hold.values());
			return () => {
				visible.current = false;
				void hold.flush().catch(() => showToast({ message: t`Couldn't forget the fact. Try again.` }));
			};
		}, [hold]),
	);
	const restore = (id: string) => {
		if (!visible.current) return;
		hold.restore(id);
		setHeld(hold.values());
	};
	const forget = () => {
		const fact = query.data?.find((item) => item.id === editing);
		if (!fact) return;
		hold.hold(fact);
		setHeld(hold.values());
		setEditing(null);
		haptic("light");
		showToast({
			message: t`Fact forgotten`,
			action: { label: t`Undo`, onPress: () => restore(fact.id) },
			// The toast going without Undo finalises the forget, unless Forgotten facts is open: then closing it does.
			onDismiss: () => {
				if (reviewing.current) finalise.current = true;
				else finaliseForgets();
			},
		});
	};
	const finaliseForgets = () => {
		finalise.current = false;
		void hold
			.flush()
			.then(() => visible.current && setHeld(hold.values()))
			.catch(() => showToast({ message: t`Couldn't forget the fact. Try again.` }));
	};
	const reviewing = useRef(false);
	const finalise = useRef(false);
	const openForgotten = () => {
		reviewing.current = true;
		setShowForgotten(true);
	};
	const closeForgotten = () => {
		reviewing.current = false;
		setShowForgotten(false);
		if (finalise.current) finaliseForgets();
	};
	const [editing, setEditing] = useState<string | null>(null);
	const [text, setText] = useState("");
	const [category, setCategory] = useState<"experience" | "skill" | "preference">("experience");
	const [saving, setSaving] = useState(false);
	const [failure, setFailure] = useState(false);
	const fake = useDataBackend().backend.kind === "fake";
	const copy = screenTexts("C3-Facts");
	const [search, setSearch] = useState("");
	const documents = useDocuments({ type: "resume" });
	const kept = (query.data ?? []).filter((fact) => !held.some((item) => item.id === fact.id));
	// ponytail: the search shows from six facts; the board draws four without it. Lower when the board allows.
	const searchable = kept.length > 5;
	const needle = search.trim().toLowerCase();
	const rows = needle ? kept.filter((fact) => fact.text.toLowerCase().includes(needle)) : kept;
	const pull = async () => {
		const resume = documents.data?.find((doc) => doc.type === "resume");
		if (!resume) return showToast({ message: t`Add a resume first.` });
		try {
			const found = await actions.proposeResumeFacts({ resumeId: resume.id });
			if (!found.proposals.length) return showToast({ message: t`No facts found in your resume.` });
			await actions.saveResumeFacts({
				resumeId: found.id,
				updatedAt: found.updatedAt,
				proposals: found.proposals.slice(0, 50),
			});
			showToast({ message: t`Added facts from your resume. Edit or forget any of them.` });
		} catch {
			showToast({ message: t`Couldn't read your resume. Try again.` });
		}
	};
	// The fixture's facts all come from the resume; the storyboard draws each row's own source line.
	const sourceOf = (fact: (typeof rows)[number]) => {
		const drawn = fake ? copy[copy.indexOf(fact.text) + 1] : undefined;
		return drawn && copy.includes(fact.text) ? drawn : factSourceLine(fact.source.kind);
	};
	const open = (id: string) => {
		const fact = query.data?.find((f) => f.id === id);
		setText(fact?.text ?? "");
		setFailure(false);
		setEditing(id);
	};
	const save = async () => {
		if (!text.trim() || saving) return;
		setSaving(true);
		setFailure(false);
		try {
			if (editing) await actions.updateFact({ id: editing, text: text.trim() });
			else
				await actions.saveFact({
					text: text.trim(),
					category,
					source: { kind: "manual", id: "", quote: "" },
				});
			setEditing(null);
		} catch {
			setFailure(true);
		} finally {
			setSaving(false);
		}
	};
	return (
		<>
			<PushScreen
				title={t`Facts`}
				subtitle={t`What the coach and assistant may use. Edit or forget any of them.`}
				barEnd={<IconButton icon="plus" label={t`Add a fact`} onPress={() => open("")} />}
			>
				<ResourceState pending={query.isPending} error={query.isError} retry={() => void query.refetch()}>
					{!query.data?.length ? (
						<View style={{ padding: 24, gap: 20 }}>
							<Text variant="heading">{t`No facts yet`}</Text>
							<Button label={t`Add a fact`} onPress={() => open("")} />
							<Button label={t`Pull facts from my resume`} onPress={() => void pull()} />
						</View>
					) : null}
					{searchable ? (
						<View style={{ paddingTop: 16, paddingHorizontal: 24 }}>
							<TextField
								leadingIcon="magnifying-glass"
								placeholder={t`Search facts`}
								value={search}
								onChangeText={setSearch}
								autoCorrect={false}
								testID="facts-search"
							/>
						</View>
					) : null}
					{searchable && needle && rows.length === 0 ? (
						<View style={{ padding: 24 }}>
							<Text variant="body" color="ink2">{t`No facts match. Try another word or type.`}</Text>
						</View>
					) : null}
					{(["experience", "skill", "preference"] as const).map((group) => {
						const items = rows.filter((f) =>
							group === "experience" ? !["skill", "preference"].includes(f.category) : f.category === group,
						);
						return items.length ? (
							<View key={group}>
								<SectionHeading
									title={group === "experience" ? t`Work` : group === "skill" ? t`Skills` : t`Preferences`}
								/>
								{items.map((fact, index) => (
									<ListRow
										key={fact.id}
										title={fact.text}
										secondary={sourceOf(fact)}
										trailing="caret"
										wrapTitle
										last={index === items.length - 1}
										boxHidden={index === items.length - 1}
										onPress={() => open(fact.id)}
									/>
								))}
							</View>
						) : null;
					})}
					{held.length || (!fake && forgotten.data?.length) ? (
						<View style={{ padding: 24 }}>
							<Button label={t`Show forgotten`} onPress={openForgotten} />
						</View>
					) : null}
				</ResourceState>
			</PushScreen>
			{showForgotten ? (
				<BottomSheet title={t`Forgotten facts`} height={480} onClose={closeForgotten}>
					{held.map((fact) => (
						<ListRow
							key={fact.id}
							title={fact.text}
							wrapTitle
							trailing={<Button label={t`Restore`} onPress={() => restore(fact.id)} />}
						/>
					))}
					<Text variant="body">{t`${forgotten.data?.reduce((sum, row) => sum + row.count, 0) ?? 0} facts permanently forgotten`}</Text>
				</BottomSheet>
			) : null}
			{editing !== null ? (
				<BottomSheet
					title={editing ? t`Correct a fact` : t`Add a fact`}
					height={480}
					keyboard
					dirty={text !== (query.data?.find((f) => f.id === editing)?.text ?? "")}
					onClose={() => setEditing(null)}
					footer={
						<FooterBar bg="raised">
							<Button
								label={t`Save`}
								disabled={!text.trim() || saving}
								tone="primary"
								block
								onPress={() => void save()}
							/>
						</FooterBar>
					}
				>
					<View style={{ padding: 24, gap: 20 }}>
						<TextField label={t`Fact`} value={text} onChangeText={setText} multiline maxLength={2000} />
						{!editing ? (
							<Segmented
								value={category}
								onChange={setCategory}
								options={[
									{ key: "experience", label: t`Work` },
									{ key: "skill", label: t`Skills` },
									{ key: "preference", label: t`Preferences` },
								]}
							/>
						) : (
							<>
								<Button label={t`Forget`} tone="dangerGhost" onPress={forget} />
								<Button
									label={t`Show forgotten`}
									onPress={() => {
										setEditing(null);
										openForgotten();
									}}
								/>
							</>
						)}
						{failure ? (
							<Text
								variant="body"
								color="dangerText"
							>{t`Couldn't save that change. Try again. Your words are kept on this device.`}</Text>
						) : null}
					</View>
				</BottomSheet>
			) : null}
		</>
	);
}
