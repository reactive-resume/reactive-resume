import type { RelinkResult } from "./save";
import type { LetterDocument } from "@/draft/types";
import type { ApplicationSummary as Application } from "@/features/applications/types";
import type { WritableDraft } from "immer";
import type { ReactNode } from "react";
import { plural, t } from "@lingui/core/macro";
import { useLingui } from "@lingui/react/macro";
import { ORPCError } from "@orpc/client";
import { useRouter } from "expo-router";
import { useState } from "react";
import { Keyboard, View, useWindowDimensions } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { coverLetterTextToHtml, defaultCoverLetterSignOff, greetingName } from "@reactive-resume/resume/cover-letter";
import { useLetterWords } from "./compose";
import { designSummary } from "./design-presets";
import { discardLetterDraft, startLetterDraft, useLetterDrafting } from "./drafting";
import { LETTER_LENGTH, countWords, letterLength } from "./length";
import { useResumes } from "./queries";
import { LetterRichText, LetterRichTextToolbar } from "./rich-text-field";
import { relinkLetter } from "./save";
import { letterFieldFocus, useLetterStore } from "@/draft";
import { AIProviderSetupSheet, useHasAIProvider } from "@/features/ai/providers";
import { WallClockField } from "@/features/application-detail/date-field";
import { useApplicationLanes } from "@/features/applications/lane-queries";
import { getLaneLabel, resolveLane } from "@/features/applications/lanes";
import { useApplications } from "@/features/applications/queries";
import { routes } from "@/routes";
import {
	Banner,
	Button,
	ListRow,
	SelectSheet,
	Sheet,
	Skeleton,
	Switch,
	Text,
	TextArea,
	TextField,
	showToast,
	useReducedMotion,
	useTheme,
} from "@/ui";
import { useKeyboardScrollSpace } from "@/ui/keyboard";

type Recipe = (letter: WritableDraft<LetterDocument>) => void;

/** Typing: one undo step per field while typing pauses under a second. */
const edit = (key: string, recipe: Recipe) => useLetterStore.getState().update(recipe, { coalesceKey: key });

/** Tells the user how a link change went: confirmed, waiting for a connection, or refused over unsaved edits. */
export function relinked(result: RelinkResult, done?: string) {
	if (result === "unsaved") showToast({ message: t`Couldn't save your changes. Try again before continuing.` });
	else if (result === "linked" && done) showToast({ message: done });
}

type SectionProps = { title: string; aside?: ReactNode; children: ReactNode };

function Section({ title, aside, children }: SectionProps) {
	const { colors, space } = useTheme();
	return (
		<View style={{ gap: space.s3, padding: space.s4, borderBottomWidth: 1, borderBottomColor: colors.line }}>
			<View style={{ flexDirection: "row", alignItems: "center", gap: space.s3 }}>
				<Text accessibilityRole="header" variant="eyebrow" color="ink3" style={{ flex: 1 }}>
					{title}
				</Text>
				{aside}
			</View>
			{children}
		</View>
	);
}

/**
 * Write: who the letter is for (the application), to (recipient, company, date) and from (the resume, live or
 * copied), then the body with its length guide and a note on the design. Ported from web's `write-panel.tsx`.
 */
export function LetterWrite({ id }: { id: string }) {
	const { t } = useLingui();
	const letter = useLetterStore((state) => (state.document?.id === id ? state.document : null));
	const status = useLetterStore((state) => state.status);
	const draft = useLetterDrafting((state) => state.draft);
	const applications = useApplications();
	const { size, space } = useTheme();
	const keyboardSpace = useKeyboardScrollSpace();

	if (!letter) {
		return status === "error" ? (
			<Banner
				tone="danger"
				message={t`Couldn't load the cover letter.`}
				action={{
					label: t`Retry`,
					onPress: () =>
						void useLetterStore
							.getState()
							.open(id)
							.catch(() => undefined),
				}}
			/>
		) : (
			<LoadingForm />
		);
	}

	const application = applications.data?.find((item) => item.id === letter.sourceApplicationId) ?? null;
	const disabled = letter.isLocked;

	return (
		<View style={{ flex: 1 }}>
			<KeyboardAwareScrollView
				extraKeyboardSpace={keyboardSpace}
				bottomOffset={size.hit + space.s4}
				keyboardShouldPersistTaps="handled"
				keyboardDismissMode="interactive"
			>
				{disabled ? (
					<Banner icon="lock" tone="info" message={t`This letter is locked. Unlock it in Documents to edit.`} />
				) : null}
				<ForSection application={application} applications={applications.data ?? []} disabled={disabled} />
				<ToSection letter={letter} application={application} disabled={disabled} />
				<FromSection letter={letter} disabled={disabled} />
				<BodySection letter={letter} application={application} disabled={disabled} />
				{/* While a draft shows, the length is the draft's. */}
				<LengthSection
					words={countWords(draft.phase === "streaming" || draft.phase === "ready" ? draft.text : letter.content)}
				/>
				<DesignNote letter={letter} />
				<View style={{ height: size.hit + space.s5 }} />
			</KeyboardAwareScrollView>
			<LetterRichTextToolbar />
		</View>
	);
}

function LoadingForm() {
	const { size, space } = useTheme();
	return (
		<View style={{ padding: space.s4, gap: space.s3 }}>
			<Skeleton height={size.hit} />
			<Skeleton height={size.hit * 3} />
		</View>
	);
}

type ForSectionProps = {
	application: Application | null;
	applications: Application[];
	disabled: boolean;
};

/** FOR: the application the letter is for. Linking one fills the recipient; without one, drafting uses the resume. */
function ForSection({ application, applications, disabled }: ForSectionProps) {
	const lanes = useApplicationLanes();
	const { t } = useLingui();
	const { colors, radius, size, space } = useTheme();
	const { fontScale } = useWindowDimensions();
	const stacked = fontScale > 1.3;
	const [open, setOpen] = useState(false);
	const [query, setQuery] = useState("");
	const search = query.trim().toLocaleLowerCase();
	const choices = applications
		.filter((item) => item.status !== "closed" || item.id === application?.id)
		.filter((item) => !search || `${item.role} ${item.company}`.toLocaleLowerCase().includes(search));

	const choose = (next: Application | null) => {
		setOpen(false);
		void relinkLetter((draft) => {
			draft.sourceApplicationId = next?.id ?? null;
			// The recipient comes from the application: its company, and its first contact when it has one.
			if (next && draft.layout === "structured") {
				draft.recipientCompany = next.company;
				draft.recipientName = next.contacts[0]?.name ?? "";
			}
		}).then((result) => relinked(result));
	};

	return (
		<Section title={t`For`}>
			{application ? (
				<View
					style={{
						flexDirection: stacked ? "column" : "row",
						alignItems: stacked ? "flex-start" : "center",
						gap: space.s3,
						padding: space.s3,
						borderWidth: 1,
						borderColor: colors.line,
						borderRadius: radius.rLg,
					}}
				>
					<View
						style={{
							minWidth: size.hit - space.s2,
							minHeight: size.hit - space.s2,
							borderRadius: radius.rLg,
							backgroundColor: colors.sunken,
							alignItems: "center",
							justifyContent: "center",
						}}
					>
						<Text weight={600} color="ink2">
							{application.company.charAt(0).toLocaleUpperCase()}
						</Text>
					</View>
					<View style={stacked ? { alignSelf: "stretch" } : { flex: 1, minWidth: 0 }}>
						<Text weight={500} numberOfLines={stacked ? undefined : 2}>
							{application.role}
						</Text>
						<View
							style={{
								flexDirection: stacked ? "column" : "row",
								alignItems: stacked ? "flex-start" : "center",
								gap: space.s1,
							}}
						>
							<Text
								variant="caption"
								color="ink3"
								numberOfLines={stacked ? undefined : 1}
								style={stacked ? { alignSelf: "stretch" } : { flexShrink: 1 }}
							>
								{application.company}
							</Text>
							<View style={{ flexDirection: "row", alignItems: "center", gap: space.s1 }}>
								<View
									style={{
										width: space.s2 - space.s0,
										height: space.s2 - space.s0,
										borderRadius: radius.rLg,
										backgroundColor: resolveLane(lanes.lanes, application).color,
									}}
								/>
								<Text variant="caption" color="ink3">
									{getLaneLabel(resolveLane(lanes.lanes, application))}
								</Text>
							</View>
						</View>
					</View>
					<Button size="sm" variant="secondary" label={t`Change`} disabled={disabled} onPress={() => setOpen(true)} />
				</View>
			) : (
				<>
					<Button
						variant="secondary"
						icon="briefcase"
						label={t`Link an application`}
						disabled={disabled}
						onPress={() => setOpen(true)}
					/>
					<Text variant="caption" color="ink3">
						{t`Without one, you fill in the recipient yourself and drafting uses only your resume.`}
					</Text>
				</>
			)}
			<Sheet
				open={open}
				title={t`Application`}
				detents={[0.5, 0.9]}
				onClose={() => {
					setOpen(false);
					setQuery("");
				}}
			>
				{applications.length === 0 ? (
					<Text color="ink2" align="center">
						{t`No applications yet. Add one in Applications first.`}
					</Text>
				) : (
					<View style={{ gap: space.s2 }}>
						<TextField label={t`Search applications`} value={query} onChangeText={setQuery} />
						{application ? (
							<ListRow title={t`No application`} leading="link-break" onPress={() => choose(null)} />
						) : null}
						{choices.map((item) => (
							<ListRow
								key={item.id}
								title={item.role}
								subtitle={`${item.company} · ${getLaneLabel(resolveLane(lanes.lanes, item))}`}
								leading="briefcase"
								selected={item.id === application?.id}
								onPress={() => choose(item)}
							/>
						))}
					</View>
				)}
			</Sheet>
		</Section>
	);
}

type LetterSectionProps = { letter: LetterDocument; application: Application | null; disabled: boolean };

/** TO: name or team, company and date for structured letters; older (freeform) letters keep their recipient block. */
function ToSection({ letter, application, disabled }: LetterSectionProps) {
	const { t } = useLingui();
	const { space } = useTheme();

	if (letter.layout === "freeform") {
		return (
			<Section title={t`To`}>
				<LetterRichText
					key={letter.id}
					label={t`Recipient`}
					value={letter.recipient}
					disabled={disabled}
					minLines={3}
					onChange={(recipient) => edit("recipient", (draft) => void (draft.recipient = recipient))}
				/>
				<Text variant="caption" color="ink3">{t`This letter keeps its recipient as written.`}</Text>
			</Section>
		);
	}

	return (
		<Section title={t`To`}>
			<TextField
				label={t`Name or team`}
				value={letter.recipientName}
				maxLength={200}
				placeholder={t`Hiring team`}
				editable={!disabled}
				returnKeyType="next"
				{...letterFieldFocus}
				onChangeText={(value) => edit("recipientName", (draft) => void (draft.recipientName = value))}
			/>
			<TextField
				label={t`Company`}
				value={letter.recipientCompany}
				maxLength={200}
				editable={!disabled}
				{...letterFieldFocus}
				onChangeText={(value) => edit("recipientCompany", (draft) => void (draft.recipientCompany = value))}
			/>
			<View style={{ flexDirection: "row", alignItems: "flex-end", gap: space.s2 }}>
				<View style={{ flex: 1 }} pointerEvents={disabled ? "none" : "auto"}>
					<WallClockField
						label={t`Date`}
						mode="date"
						value={letter.letterDate ?? ""}
						onChange={(value) => edit("letterDate", (draft) => void (draft.letterDate = value))}
					/>
				</View>
				{letter.letterDate && !disabled ? (
					<Button
						size="sm"
						variant="ghost"
						label={t`No date`}
						onPress={() => edit("letterDate", (draft) => void (draft.letterDate = null))}
					/>
				) : null}
			</View>
			<Text variant="caption" color="ink3">
				{application
					? t`Filled from the application. The greeting follows the name.`
					: t`The greeting follows the name.`}
			</Text>
		</Section>
	);
}

/** FROM: the resume the sender's details come from, and whether they stay live or are copied into the letter. */
function FromSection({ letter, disabled }: { letter: LetterDocument; disabled: boolean }) {
	const { t } = useLingui();
	const resumes = useResumes();
	const resume = resumes.data?.find((item) => item.id === letter.sourceResumeId);
	const resumeName = resume?.name;
	const useDetailsLabel = resumeName ? t`Use details from “${resumeName}”` : t`Use details from the resume`;

	const setResume = (resumeId: string) =>
		void relinkLetter((draft) => {
			// A letter taking a resume for the first time takes its details and design with it.
			if (resumeId && !draft.sourceResumeId) {
				draft.senderLinked = true;
				draft.designLinked = true;
			}
			if (!resumeId) {
				draft.senderLinked = false;
				draft.designLinked = false;
			}
			draft.sourceResumeId = resumeId || null;
		}).then((result) => relinked(result));

	const setLinked = (senderLinked: boolean) => {
		void relinkLetter((draft) => void (draft.senderLinked = senderLinked)).then((result) =>
			relinked(result, senderLinked ? t`Linked to the resume again` : t`Sender details copied into the letter`),
		);
	};

	return (
		<Section title={t`From`}>
			<SelectSheet
				label={t`Resume`}
				value={letter.sourceResumeId ?? ""}
				disabled={disabled || resumes.isPending}
				options={[
					{ value: "", label: t`No resume` },
					...(resumes.data ?? []).map((item) => ({ value: item.id, label: item.name, icon: "file-text" as const })),
				]}
				onChange={setResume}
			/>
			{resumes.isError ? (
				<Banner
					tone="warn"
					message={t`Couldn't load your resumes.`}
					action={{ label: t`Retry`, onPress: () => void resumes.refetch() }}
				/>
			) : null}
			{letter.sourceResumeId ? (
				<ListRow
					title={useDetailsLabel}
					subtitle={
						letter.senderLinked
							? t`Linked. Name, email, phone and city update when the resume does.`
							: t`Off. The letter keeps its own copy of your details.`
					}
					trailing={
						<Switch label={useDetailsLabel} value={letter.senderLinked} disabled={disabled} onValueChange={setLinked} />
					}
				/>
			) : (
				<Text variant="caption" color="ink3">{t`Your name and contact details come from a resume.`}</Text>
			)}
		</Section>
	);
}

/**
 * The body. Empty, it offers a draft from the posting and the resume. A draft shows on a green wash until it's kept:
 * it never replaces typed text by itself.
 */
function BodySection({ letter, application, disabled }: LetterSectionProps) {
	const { t } = useLingui();
	const { space } = useTheme();
	const words = useLetterWords(letter.style.metadata.page.locale);
	const draft = useLetterDrafting((state) => state.draft);
	// Once the editor shows it stays, so clearing the text while typing never swaps it for the draft offer.
	const [writing, setWriting] = useState(() => countWords(letter.content) > 0);
	const structured = letter.layout === "structured";
	const name = greetingName(letter.recipientName);
	const showEditor = writing || countWords(letter.content) > 0;

	const body =
		draft.phase !== "idle" ? (
			<DraftBox
				letter={letter}
				application={application}
				onKeep={(text) => {
					useLetterStore.getState().update((value) => void (value.content = coverLetterTextToHtml(text)), {
						newStep: true,
					});
					discardLetterDraft();
					setWriting(true);
					showToast({ message: t`Draft kept. Edit anything you like.` });
				}}
			/>
		) : showEditor ? (
			<LetterRichText
				key={letter.id}
				label={t`Letter body`}
				value={letter.content}
				disabled={disabled}
				autoFocus={writing && countWords(letter.content) === 0}
				onChange={(content) => edit("content", (value) => void (value.content = content))}
			/>
		) : (
			<EmptyBody letter={letter} application={application} disabled={disabled} onWrite={() => setWriting(true)} />
		);

	return (
		<Section title={t`Letter`}>
			{structured && words ? (
				<FramingField
					letter={letter}
					field="greeting"
					defaultValue={name ? words.greeting(name) : words.teamGreeting}
					disabled={disabled}
				/>
			) : null}
			{body}
			{structured && words ? (
				<View style={{ gap: space.s2 }}>
					<FramingField
						letter={letter}
						field="signOff"
						defaultValue={defaultCoverLetterSignOff(letter, words)}
						disabled={disabled}
					/>
					<Text variant="caption" color="ink3">
						{t`Clear the greeting or sign-off to omit it. Clearing the sign-off also removes the automatic signature.`}
					</Text>
				</View>
			) : null}
		</Section>
	);
}

type FramingFieldProps = {
	letter: LetterDocument;
	field: "greeting" | "signOff";
	defaultValue: string;
	disabled: boolean;
};

/** Greeting and sign-off: plain text that follows the recipient and locale until edited. */
function FramingField({ letter, field, defaultValue, disabled }: FramingFieldProps) {
	const { t } = useLingui();
	const { space } = useTheme();
	const label = field === "greeting" ? t`Greeting` : t`Sign-off`;
	return (
		<View style={{ gap: space.s1 }}>
			<TextArea
				label={label}
				value={letter[field] ?? defaultValue}
				maxLength={2_000}
				minLines={field === "greeting" ? 1 : 2}
				editable={!disabled}
				{...letterFieldFocus}
				onChangeText={(value) => edit(field, (draft) => void (draft[field] = value))}
			/>
			{letter[field] !== null && !disabled ? (
				<Button
					size="sm"
					variant="ghost"
					label={t`Use default`}
					onPress={() => useLetterStore.getState().update((draft) => void (draft[field] = null), { newStep: true })}
				/>
			) : null}
		</View>
	);
}

type EmptyBodyProps = {
	letter: LetterDocument;
	application: Application | null;
	disabled: boolean;
	onWrite: () => void;
};

function EmptyBody({ letter, application, disabled, onWrite }: EmptyBodyProps) {
	const { t } = useLingui();
	const { colors, radius, space } = useTheme();
	const ai = useHasAIProvider();
	const [setup, setSetup] = useState(false);
	const hasResume = !!letter.sourceResumeId;
	const company = application?.company;
	const canDraft = hasResume || !!application;

	return (
		<View
			style={{
				gap: space.s3,
				padding: space.s4,
				borderWidth: 1,
				borderStyle: "dashed",
				borderColor: colors.line2,
				borderRadius: radius.rLg,
			}}
		>
			<Text color="ink2">
				{company && hasResume
					? t`Start typing, or draft from what we know: the ${company} posting and your resume.`
					: company
						? t`Start typing, or draft from what we know: the ${company} posting.`
						: hasResume
							? t`Start typing, or draft from what we know: your resume.`
							: t`Start typing. To draft one, link a resume or an application first.`}
			</Text>
			<View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.s2 }}>
				{canDraft && ai.hasAIProvider ? (
					<Button
						size="sm"
						icon="sparkle"
						label={application ? t`Draft from the posting` : t`Draft from your resume`}
						disabled={disabled}
						onPress={() => {
							Keyboard.dismiss();
							void startLetterDraft("draft");
						}}
					/>
				) : null}
				<Button size="sm" variant="secondary" label={t`Write it myself`} disabled={disabled} onPress={onWrite} />
			</View>
			{canDraft && ai.error ? (
				<Banner
					tone="warn"
					message={t`Couldn't check your AI providers.`}
					action={{ label: t`Retry`, onPress: ai.retry }}
				/>
			) : null}
			{canDraft && !ai.isUnavailable && !ai.hasAIProvider ? (
				<View style={{ gap: space.s1 }}>
					<Text variant="caption" color="ink3">{t`Drafting needs an AI provider.`}</Text>
					<Button size="sm" variant="link" label={t`Open AI settings`} onPress={() => setSetup(true)} />
				</View>
			) : null}
			<AIProviderSetupSheet open={setup} onClose={() => setSetup(false)} />
		</View>
	);
}

type DraftBoxProps = { letter: LetterDocument; application: Application | null; onKeep: (text: string) => void };

/** The draft on its green wash, then Keep, Shorter, More personal or Discard. */
function DraftBox({ letter, application, onKeep }: DraftBoxProps) {
	const { t } = useLingui();
	const { colors, radius, size, space } = useTheme();
	const reducedMotion = useReducedMotion();
	const draft = useLetterDrafting((state) => state.draft);
	const last = useLetterDrafting((state) => state.last);

	if (draft.phase === "idle") return null;
	if (draft.phase === "unsaved") {
		return (
			<View style={{ gap: space.s2 }}>
				<Banner
					tone="danger"
					message={t`Couldn't save your changes, so drafting didn't start. Nothing on the page changed.`}
				/>
				<View style={{ flexDirection: "row", gap: space.s2 }}>
					<Button
						size="sm"
						variant="secondary"
						label={t`Try again`}
						onPress={() => void startLetterDraft(last.variant, last.previous)}
					/>
					<Button size="sm" variant="ghost" label={t`Dismiss`} onPress={discardLetterDraft} />
				</View>
			</View>
		);
	}
	if (draft.phase === "failed") {
		const gateway = draft.error instanceof ORPCError && draft.error.code === "BAD_GATEWAY";
		return (
			<View style={{ gap: space.s2 }}>
				<Banner
					tone="danger"
					message={
						gateway && draft.provider
							? t`Drafting stopped: ${draft.provider} didn't respond. Nothing on the page changed.`
							: t`Drafting stopped. Nothing on the page changed.`
					}
				/>
				<View style={{ flexDirection: "row", gap: space.s2 }}>
					<Button
						size="sm"
						variant="secondary"
						label={t`Try again`}
						onPress={() => void startLetterDraft(last.variant, last.previous)}
					/>
					<Button size="sm" variant="ghost" label={t`Dismiss`} onPress={discardLetterDraft} />
				</View>
			</View>
		);
	}

	const streaming = draft.phase === "streaming";
	const sources =
		letter.sourceResumeId && application
			? t`Draft · uses only your resume and the posting`
			: application
				? t`Draft · uses only the posting`
				: t`Draft · uses only your resume`;

	return (
		<View style={{ gap: space.s2 }}>
			<Text variant="caption" color="ink3">
				{sources}
			</Text>
			<View
				accessibilityLiveRegion="polite"
				style={{
					minHeight: size.hit * 3,
					padding: space.s3,
					borderRadius: radius.rLg,
					borderWidth: 1,
					borderColor: draft.phase === "ready" ? colors.accent : "transparent",
					backgroundColor: colors.accentSoft,
				}}
			>
				<Text>
					{/* Reduced motion shows the whole draft at once. */}
					{streaming && reducedMotion ? "" : draft.text}
					{streaming ? <Text color="ink3">{reducedMotion ? t`Drafting…` : "▍"}</Text> : null}
				</Text>
			</View>
			{streaming ? (
				<Button size="sm" variant="secondary" icon="stop" label={t`Stop`} onPress={discardLetterDraft} />
			) : (
				<View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.s2 }}>
					<ReportAiContent source="letter" text={draft.text} />
					<Button size="sm" label={t`Keep`} onPress={() => onKeep(draft.text)} />
					<Button
						size="sm"
						variant="secondary"
						label={t`Shorter`}
						onPress={() => void startLetterDraft("shorter", draft.text)}
					/>
					<Button
						size="sm"
						variant="secondary"
						label={t`More personal`}
						onPress={() => void startLetterDraft("personal", draft.text)}
					/>
					<Button size="sm" variant="dangerOutline" label={t`Discard`} onPress={discardLetterDraft} />
				</View>
			)}
		</View>
	);
}

/** Length: the word count against the 180 to 320 band most recruiters read, as a hint rather than a rule. */
function LengthSection({ words }: { words: number }) {
	const { t } = useLingui();
	const { colors, radius, space } = useTheme();
	const length = letterLength(words);
	const tone = length === "empty" ? "ink3" : length === "comfortable" ? "accentText" : "warnText";
	const percent = (value: number) => `${(value / LETTER_LENGTH.scale) * 100}%` as const;

	return (
		<Section
			title={t`Length`}
			aside={
				<Text variant="mono" color={tone}>
					{plural(words, { one: "# word", other: "# words" })}
				</Text>
			}
		>
			<View
				accessibilityElementsHidden
				importantForAccessibility="no-hide-descendants"
				style={{
					height: space.s2 - space.s0,
					borderRadius: radius.rLg,
					backgroundColor: colors.sunken,
					overflow: "hidden",
				}}
			>
				<View
					style={{
						position: "absolute",
						top: 0,
						bottom: 0,
						start: percent(LETTER_LENGTH.min),
						width: percent(LETTER_LENGTH.max - LETTER_LENGTH.min),
						backgroundColor: colors.line2,
					}}
				/>
				<View
					style={{
						height: "100%",
						width: percent(Math.min(words, LETTER_LENGTH.scale)),
						borderRadius: radius.rLg,
						backgroundColor: length === "empty" ? colors.line2 : length === "comfortable" ? colors.accent : colors.warn,
					}}
				/>
			</View>
			<Text variant="caption" color={length === "long" ? "warnText" : "ink3"}>
				{length === "empty"
					? t`Most recruiters read 180–320 words. The shaded band shows the range.`
					: length === "short"
						? t`Short and direct. Fine if the posting asks for brevity.`
						: length === "comfortable"
							? t`A comfortable length, and it fits on one page.`
							: t`Getting long. Try “Shorter”, or cut the least specific paragraph.`}
			</Text>
		</Section>
	);
}

/** DESIGN: what the letter looks like, and where to change it. */
function DesignNote({ letter }: { letter: LetterDocument }) {
	const router = useRouter();
	const { t, i18n } = useLingui();
	const summary = designSummary(letter.style.metadata, i18n, (pairing) => t`${pairing} type`);
	return (
		<Section title={t`Design`}>
			<Text color="ink2">
				{letter.designLinked ? t`Matches the resume (${summary}).` : t`Its own design (${summary}).`}
			</Text>
			<Button
				size="sm"
				variant="link"
				label={t`Change it in Design.`}
				onPress={() => router.replace(routes.letter(letter.id, "design"))}
			/>
		</Section>
	);
}
import { ReportAiContent } from "@/features/ai/report-content";
