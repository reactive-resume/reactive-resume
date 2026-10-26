import type { EnrichedTextInputInstance } from "react-native-enriched-html";
import { useLingui } from "@lingui/react/macro";
import { useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { View } from "react-native";
import { EnrichedTextInput } from "react-native-enriched-html";
import { client } from "@/api/client";
import { resumeFieldFocus, useResumeStore } from "@/draft";
import { resume as draftResume } from "@/draft/runtime";
import { useNewDocuments } from "@/features/documents/new-documents";
import { useDocumentOperations } from "@/features/documents/queries";
import { flushResume } from "@/features/share/document";
import { printResume } from "@/features/share/files";
import { MAX_SLUG_LENGTH, normalizeSlug, validSlug } from "@/features/share/model";
import { routes } from "@/routes";
import { useBuilderChrome } from "@/shell/builder-chrome";
import { useKeyCommands } from "@/shell/key-commands";
import { Banner, Button, IconButton, ListRow, Sheet, Text, TextField, showToast, useTheme } from "@/ui";

type DocumentMenuProps = {
	id: string;
	/** Opens from the document name in the builder top bar instead of its own ⋯ button. */
	inChrome?: boolean;
};
/** BuilderChrome can mount this trigger; it owns no draft lifecycle. */
export function DocumentMenu({ id, inChrome = false }: DocumentMenuProps) {
	const router = useRouter();
	const { t, i18n } = useLingui();
	const { space } = useTheme();
	const draft = useResumeStore();
	const resume = draft.document?.id === id ? draft.document : null;
	const operations = useDocumentOperations();
	const [panel, setPanel] = useState<"menu" | "rename" | "duplicate" | "notes" | "details" | null>(null);
	const [name, setName] = useState("");
	const [slug, setSlug] = useState("");
	const pending = useRef(Promise.resolve(false));
	const [printing, setPrinting] = useState(false);
	const printingRef = useRef(false);
	const close = () => {
		if (!operations.busy && !printing) setPanel(null);
	};
	const run = async (action: () => Promise<unknown>) => {
		const task = operations.run(action);
		pending.current = task;
		if (await task) setPanel(null);
	};
	const openMenu = () => {
		setName(resume?.name ?? "");
		setPanel("menu");
	};
	const print = () => {
		if (!resume || printingRef.current) return;
		printingRef.current = true;
		setPrinting(true);
		void printResume(resume.data, resume.name)
			.catch(() => showToast({ message: t`Couldn't print. Try again.` }))
			.finally(() => {
				printingRef.current = false;
				setPrinting(false);
			});
	};
	useBuilderChrome(inChrome ? { onMenu: resume ? openMenu : undefined } : {});
	useKeyCommands(inChrome ? [{ id: "print", input: "p", title: t`Print`, run: print }] : []);
	const titles = {
		menu: t`Document options`,
		rename: t`Rename`,
		duplicate: t`Duplicate resume`,
		notes: t`Notes`,
		details: t`Resume details`,
	};
	return (
		<>
			{!inChrome && <IconButton icon="dots-three" label={t`Document options`} disabled={!resume} onPress={openMenu} />}
			<Sheet open={!!panel} title={panel ? titles[panel] : undefined} onClose={close} detents={[0.5, 0.9]}>
				{resume && (
					<View style={{ padding: space.s4, gap: space.s3 }}>
						{operations.error && <Banner tone="danger" message={operations.error} />}
						{panel === "menu" && (
							<>
								<Text variant="title">{resume.name}</Text>
								<ListRow
									title={t`Rename…`}
									leading="pencil-simple"
									disabled={resume.isLocked || operations.busy}
									onPress={() => setPanel("rename")}
								/>
								<ListRow
									title={t`Duplicate`}
									leading="copy"
									disabled={operations.busy || printing}
									onPress={() => {
										setName(t`${resume.name} (copy)`.slice(0, 100));
										setSlug("");
										setPanel("duplicate");
									}}
								/>
								<ListRow
									title={resume.isLocked ? t`Unlock editing` : t`Lock editing`}
									leading={resume.isLocked ? "lock-open" : "lock"}
									disabled={operations.busy || printing}
									onPress={() =>
										void run(async () => {
											if (!resume.isLocked) await flushResume(id);
											await client.documents.setLocked({ type: "resume", id, isLocked: !resume.isLocked });
											// Metadata-only change: refresh keeps undo history and skips a draft that is no longer this resume.
											await draftResume.refresh();
										})
									}
								/>
								<ListRow
									title={t`Notes`}
									leading="note"
									disabled={operations.busy || printing}
									onPress={() => setPanel("notes")}
								/>
								<ListRow
									title={t`Details`}
									leading="info"
									disabled={operations.busy || printing}
									onPress={() => setPanel("details")}
								/>
								<ListRow
									title={t`History`}
									leading="clock-counter-clockwise"
									disabled={operations.busy || printing}
									onPress={() => {
										setPanel(null);
										router.push(routes.history(id));
									}}
								/>
								<ListRow title={t`Print`} leading="printer" disabled={operations.busy || printing} onPress={print} />
								<ListRow
									title={t`Move to Trash`}
									leading="trash"
									destructive
									disabled={resume.isLocked || operations.busy}
									onPress={() =>
										void run(async () => {
											await flushResume(id);
											await client.documents.trash({ type: "resume", id });
											await useResumeStore.getState().close();
											router.replace(routes.documents());
											showToast({
												message: t`“${resume.name}” moved to Trash`,
												action: {
													label: t`Undo`,
													onPress: () => {
														void pending.current.then(() =>
															operations.run(() => client.documents.restore({ type: "resume", id })),
														);
													},
												},
											});
										})
									}
								/>
							</>
						)}
						{panel === "rename" && (
							<>
								<TextField
									label={t`Name`}
									value={name}
									onChangeText={setName}
									maxLength={100}
									editable={!operations.busy && !resume.isLocked}
								/>
								<Button
									label={t`Save`}
									disabled={!name.trim() || resume.isLocked}
									loading={operations.busy}
									onPress={() =>
										void run(async () => {
											await flushResume(id);
											useResumeStore.getState().updateDocument((value) => {
												value.name = name.trim();
											});
											await flushResume(id);
										})
									}
								/>
							</>
						)}
						{panel === "duplicate" && (
							<>
								<TextField
									label={t`Name`}
									value={name}
									onChangeText={setName}
									maxLength={100}
									editable={!operations.busy}
								/>
								<TextField
									label={t`Slug`}
									value={slug}
									onChangeText={(value) => setSlug(normalizeSlug(value))}
									editable={!operations.busy}
									autoCapitalize="none"
									autoCorrect={false}
									helper={t`Leave empty to generate an available address from the name.`}
									error={
										!slug
											? undefined
											: slug.length > MAX_SLUG_LENGTH
												? t`Use at most 64 characters.`
												: !validSlug(slug)
													? t`Use lowercase letters, numbers and single dashes.`
													: undefined
									}
								/>
								<Button
									label={t`Duplicate`}
									loading={operations.busy}
									disabled={!name.trim() || (!!slug && !validSlug(slug))}
									onPress={() =>
										void run(async () => {
											const current = await flushResume(id);
											const copy = await client.resume.duplicate({
												id,
												name: name.trim(),
												tags: current.tags,
												...(slug ? { slug } : {}),
											});
											useNewDocuments.getState().markNew({ id: copy, type: "resume" });
											showToast({ message: t`Copy created` });
											router.replace(routes.builder(copy));
										})
									}
								/>
							</>
						)}
						{panel === "notes" && (
							<>
								<Text color="ink2">{t`Keep private notes about this resume here. Nobody else can see them.`}</Text>
								<NotesEditor id={id} value={resume.data.metadata.notes} locked={resume.isLocked} />
								<Text variant="caption" color="ink3">{t`Draft · not printed`}</Text>
							</>
						)}
						{panel === "details" && (
							<>
								<Text variant="title">{resume.name}</Text>
								<ListRow title={t`Created`} subtitle={resume.createdAt.toLocaleString(i18n.locale)} />
								<ListRow title={t`Last edited`} subtitle={resume.updatedAt.toLocaleString(i18n.locale)} />
								<ListRow title={t`Template`} subtitle={resume.data.metadata.template} />
								<ListRow title={t`Language`} subtitle={resume.data.metadata.page.locale} />
								<ListRow
									title={t`Sharing`}
									subtitle={
										resume.isPublic
											? resume.hasPassword
												? t`Public, with a password`
												: t`Public`
											: t`Private. Only you can see it.`
									}
								/>
								<Text selectable color="ink3">
									{resume.slug}
								</Text>
							</>
						)}
						{panel !== "menu" ? (
							<Button
								label={t`Back`}
								variant="ghost"
								disabled={operations.busy || printing}
								onPress={() => setPanel("menu")}
							/>
						) : null}
					</View>
				)}
			</Sheet>
		</>
	);
}

type NotesEditorProps = { id: string; value: string; locked: boolean };
function NotesEditor({ id, value, locked }: NotesEditorProps) {
	const { t } = useLingui();
	const { space, colors, radius, type } = useTheme();
	const editor = useRef<EnrichedTextInputInstance>(null);
	const last = useRef(value);
	const focused = useRef(false);
	useEffect(
		() => () => {
			if (focused.current) {
				focused.current = false;
				resumeFieldFocus.onBlur();
			}
		},
		[],
	);
	useEffect(() => {
		if (!focused.current && value !== last.current) {
			last.current = value;
			editor.current?.setValue(value);
		}
	}, [value]);
	return (
		<EnrichedTextInput
			key={id}
			ref={editor}
			accessibilityLabel={t`Notes`}
			defaultValue={value}
			editable={!locked}
			onFocus={() => {
				focused.current = true;
				resumeFieldFocus.onFocus();
			}}
			onBlur={() => {
				focused.current = false;
				resumeFieldFocus.onBlur();
			}}
			style={{
				minHeight: space.s12 * 3,
				color: colors.ink,
				backgroundColor: colors.raised,
				borderColor: colors.lineStrong,
				borderWidth: 1,
				borderRadius: radius.rMd,
				padding: space.s3,
				fontFamily: type.body.fontFamily,
				fontSize: type.body.fontSize,
			}}
			onChangeHtml={(event) => {
				if (!focused.current) return;
				const html = event.nativeEvent.value;
				last.current = html;
				useResumeStore.getState().update(
					(data) => {
						data.metadata.notes = html;
					},
					{ coalesceKey: "metadata.notes" },
				);
			}}
		/>
	);
}
