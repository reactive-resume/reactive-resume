import { t } from "@lingui/core/macro";
import { useQueryClient } from "@tanstack/react-query";
import { printAsync } from "expo-print";
import { useRouter } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import { prepareExport } from "../download/export-file";
import { DocumentState, useBuilderDocument, useDocumentId } from "../share/document";
import { moveToTrash, restore, useDataActions, useResumeStore } from "@/data";
import { STORYBOARD } from "@/dev/storyboard/harness";
import { SheetScreen, ListRow, IconTile, Text, TextField, Form, Button, showToast, haptic } from "@/ui";

export function MenuScreen() {
	const id = useDocumentId();
	const router = useRouter();
	const query = useBuilderDocument(id);
	const document = query.data;
	const actions = useDataActions();
	const cache = useQueryClient();
	const draft = useResumeStore();
	const [step, setStep] = useState("menu");
	const [value, setValue] = useState("");
	const [error, setError] = useState("");
	const [busy, setBusy] = useState(false);
	const locked = document?.isLocked ?? false;
	const run = async (operation: () => Promise<unknown>) => {
		if (busy) return;
		setBusy(true);
		setError("");
		try {
			await operation();
		} catch {
			setError(t`Couldn't update this document. Try again.`);
			haptic("error");
		} finally {
			setBusy(false);
		}
	};
	const trash = () =>
		run(async () => {
			if (locked) return;
			if (draft.document?.id === id) {
				await draft.flush();
				if (useResumeStore.getState().status !== "saved") throw new Error("Save changes before moving this document.");
			}
			const ref = { type: "resume" as const, id };
			await moveToTrash(ref);
			await cache.invalidateQueries();
			haptic("light");
			showToast({
				message: t`Moved to Trash`,
				action: {
					label: t`Undo`,
					onPress: () => {
						void restore(ref)
							.then(() => cache.invalidateQueries())
							.catch(() => showToast({ message: t`Couldn't restore the document. Try again in Trash.` }));
					},
				},
			});
			router.replace("/documents");
		});
	const row = (
		title: string,
		icon: Parameters<typeof IconTile>[0]["icon"],
		onPress?: () => void,
		disabled = false,
		secondary?: string,
	) => (
		<ListRow
			title={title}
			leading={<IconTile icon={icon} accent={title === t`Unlock editing`} />}
			{...(secondary ? { secondary } : {})}
			{...(onPress ? { onPress } : {})}
			disabled={disabled}
		/>
	);
	return (
		<SheetScreen title={step === "rename" ? t`Rename…` : (document?.name ?? t`Document`)} height={790} step={step}>
			<DocumentState loading={query.isPending} error={query.isError} retry={() => void query.refetch()} />
			{document &&
				(step === "rename" ? (
					<>
						<Form>
							<TextField label={t`Name`} value={value} onChangeText={setValue} maxLength={100} />
						</Form>
						<View style={{ margin: 24, gap: 12 }}>
							<Button
								label={t`Save`}
								disabled={busy || !value.trim()}
								onPress={() =>
									void run(async () => {
										await actions.write("documents", "documents.rename", { type: "resume", id, name: value.trim() });
										setStep("menu");
									})
								}
							/>
							<Button label={t`Cancel`} onPress={() => setStep("menu")} />
						</View>
					</>
				) : (
					<>
						<View style={{ marginHorizontal: 24, marginTop: 16, gap: 16 }}>
							{[
								[
									t`Created`,
									STORYBOARD ? "28 Oct 2026" : document.createdAt.toLocaleDateString(),
									t`Last edited`,
									STORYBOARD ? "12 min ago" : document.updatedAt.toLocaleDateString(),
								],
								[t`Language`, STORYBOARD ? "English (UK)" : document.data.metadata.page.locale, t`Length`, t`1 page`],
								[t`Sharing`, document.isPublic ? t`Public` : t`Private`, t`Template`, document.data.metadata.template],
							].map(([a, b, c, d]) => (
								<View key={a} style={{ flexDirection: "row", gap: 16 }}>
									<View style={{ flex: 1, gap: 2 }}>
										<Text variant="small" color="ink3">
											{a}
										</Text>
										<Text>{b}</Text>
									</View>
									<View style={{ flex: 1, gap: 2 }}>
										<Text variant="small" color="ink3">
											{c}
										</Text>
										<Text>{d}</Text>
									</View>
								</View>
							))}
						</View>
						<View style={{ marginTop: 16 }}>
							{row(
								locked ? t`Unlock editing` : t`Lock editing`,
								locked ? "lock-simple-open" : "lock-simple",
								undefined,
								true,
							)}
							{row(
								t`Rename…`,
								"pencil-simple",
								() => {
									setValue(document.name);
									setStep("rename");
								},
								locked,
							)}
							{row(t`Tags`, "tag", undefined, false, document.tags.join(", "))}
							{row(t`Duplicate`, "copy", undefined, true)}
							{row(t`Translate into…`, "translate", undefined, true)}
							{row(t`Copy for a job…`, "briefcase", undefined, true)}
							{row(t`Notes`, "note", undefined, true, t`Only you can see these`)}
							{row(
								t`Print`,
								"printer",
								() =>
									void run(async () => {
										const file = await prepareExport(document, "resume", "pdf", `${document.data.basics.name} Resume`);
										await printAsync({ uri: file.uri });
									}),
							)}
							{row(t`Move to trash`, "trash", () => void trash(), locked)}
						</View>
					</>
				))}
			{error && (
				<Text color="dangerText" accessibilityRole="alert" style={{ margin: 24 }}>
					{error}
				</Text>
			)}
		</SheetScreen>
	);
}
