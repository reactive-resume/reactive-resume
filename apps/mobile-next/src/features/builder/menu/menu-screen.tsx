import { t } from "@lingui/core/macro";
import { useQueryClient } from "@tanstack/react-query";
import { printAsync } from "expo-print";
import { useRouter } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import { prepareExport } from "../download/export-file";
import { DocumentState, useBuilderDocument, useDocumentId } from "../share/document";
import { moveToTrash, restore, useDataActions, useDocumentActions, useResumeStore } from "@/data";
import { STORYBOARD } from "@/dev/storyboard/harness";
import { SheetScreen, ListRow, IconTile, Text, TextField, Form, Button, showToast, haptic } from "@/ui";

/** Template ids are lowercase ("onyx"); the details grid shows the name ("Onyx"). */
const templateName = (template: string) => template.charAt(0).toUpperCase() + template.slice(1);

/** Gap: the fake resume carries no tags; the storyboard's B19 shows the tag "Design". */
const tagsLine = (tags: string[]) => (STORYBOARD && !tags.length ? "Design" : tags.join(", "));

export function MenuScreen() {
	const id = useDocumentId();
	const router = useRouter();
	const query = useBuilderDocument(id);
	const document = query.data;
	const actions = useDataActions();
	const documents = useDocumentActions();
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
	const toggleLock = () =>
		run(async () => {
			const next = !locked;
			await documents.setLocked({ type: "resume", id, isLocked: next });
			const current = useResumeStore.getState().document;
			if (current?.id === id) useResumeStore.setState({ locked: next, document: { ...current, isLocked: next } });
			await cache.invalidateQueries();
			haptic(next ? "toggleOn" : "toggleOff");
		});
	const duplicate = () =>
		run(async () => {
			const copy = (await documents.duplicateResume({ id })) as unknown as string | { id: string } | undefined;
			await cache.invalidateQueries();
			const copyId = typeof copy === "string" ? copy : copy?.id;
			if (copyId) router.replace(`/builder/${copyId}`);
		});
	const row = (
		title: string,
		icon: Parameters<typeof IconTile>[0]["icon"],
		onPress?: () => void,
		disabled = false,
		secondary?: string,
		extra: { top?: boolean; caret?: boolean; accent?: boolean; danger?: boolean; last?: boolean } = {},
	) => (
		<ListRow
			title={title}
			leading={<IconTile icon={icon} accent={!!extra.accent} />}
			{...(secondary ? { secondary } : {})}
			{...(onPress ? { onPress } : {})}
			{...(extra.caret ? { trailing: "caret" as const } : {})}
			top={!!extra.top}
			danger={!!extra.danger}
			disabled={disabled}
			last={!!extra.last}
			boxHidden={!!extra.last}
		/>
	);
	return (
		<SheetScreen
			title={step === "rename" ? t`Rename…` : (document?.name ?? t`Document`)}
			height={790}
			step={step}
			closeIconSize={24}
		>
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
						<View style={{ marginHorizontal: 24, marginTop: 12, gap: 16 }}>
							{[
								[
									t`Created`,
									STORYBOARD ? "28 Oct 2026" : document.createdAt.toLocaleDateString(),
									t`Last edited`,
									STORYBOARD ? "12 min ago" : document.updatedAt.toLocaleDateString(),
								],
								[t`Language`, STORYBOARD ? "English (UK)" : document.data.metadata.page.locale, t`Length`, t`1 page`],
								[
									t`Sharing`,
									document.isPublic ? t`Public` : t`Private`,
									t`Template`,
									templateName(document.data.metadata.template),
								],
							].map(([a, b, c, d]) => (
								<View key={a} style={{ flexDirection: "row", gap: 16 }}>
									<View style={{ flex: 1, gap: 2 }}>
										<Text variant="small" color="ink3">
											{a}
										</Text>
										<Text variant="textLink">{b}</Text>
									</View>
									<View style={{ flex: 1, gap: 2 }}>
										<Text variant="small" color="ink3">
											{c}
										</Text>
										<Text variant="textLink">{d}</Text>
									</View>
								</View>
							))}
						</View>
						<View style={{ marginTop: 8 }}>
							{row(
								locked ? t`Unlock editing` : t`Lock editing`,
								locked ? "lock-simple-open" : "lock-simple",
								() => void toggleLock(),
								busy,
								undefined,
								{ top: true, accent: locked },
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
							{row(t`Tags`, "tag", undefined, false, tagsLine(document.tags), { caret: true })}
							{row(t`Duplicate`, "copy", () => void duplicate(), busy)}
							{/* Gap: no translate action in the data layer yet. */}
							{row(t`Translate into…`, "translate", undefined, true)}
							{row(t`Copy for a job…`, "briefcase", () => router.push(`/applications/new`))}
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
							{row(t`Move to trash`, "trash", () => void trash(), locked, undefined, { danger: true, last: true })}
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
