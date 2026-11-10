import { t } from "@lingui/core/macro";
import { useState } from "react";
import { View } from "react-native";
import { factSourceLine } from "./model";
import { ResourceState } from "./shared";
import { screenTexts, useCareerFacts, useDataActions, useDataBackend } from "@/data";
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
} from "@/ui";

export function FactsScreen() {
	const query = useCareerFacts({ all: true });
	const actions = useDataActions();
	const [editing, setEditing] = useState<string | null>(null);
	const [text, setText] = useState("");
	const [category, setCategory] = useState<"experience" | "skill" | "preference">("experience");
	const [saving, setSaving] = useState(false);
	const [failure, setFailure] = useState(false);
	const fake = useDataBackend().backend.kind === "fake";
	const copy = screenTexts("C3-Facts");
	const rows = query.data ?? [];
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
			if (editing) await actions.write("stories-and-facts", "career.updateFact", { id: editing, text: text.trim() });
			else
				await actions.write("stories-and-facts", "career.saveFact", {
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
							<Button label={t`Pull facts from my resume`} disabled />
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
										onPress={() => open(fact.id)}
									/>
								))}
							</View>
						) : null;
					})}
				</ResourceState>
			</PushScreen>
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
							<Button label={t`Forget`} tone="dangerGhost" disabled />
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
