import type { RichTextSession } from "./rich-text";
import type { IconName } from "@/ui";
import type { ComponentRef, RefObject } from "react";
import type { EnrichedTextInputInstance, OnChangeStateEvent } from "react-native-enriched-html";
import { plural } from "@lingui/core/macro";
import { useLingui } from "@lingui/react/macro";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { ScrollView, View } from "react-native";
import { EnrichedTextInput } from "react-native-enriched-html";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ImprovePanel } from "./improve";
import { PromptSheet } from "./pickers";
import { createRichTextSession, fromEnrichedHtml, lineAtCaret, replaceLine } from "./rich-text";
import { resumeFieldFocus } from "@/draft";
import { Button, IconButton, ListRow, Sheet, Text, useTheme } from "@/ui";
import { useKeyboardVisible } from "@/ui/keyboard";

/** The focused editor, for the toolbar docked above the keyboard (one per screen). */
type ActiveEditor = {
	ref: RefObject<EnrichedTextInputInstance | null>;
	focused: boolean;
	state: OnChangeStateEvent | null;
	selection: { start: number; end: number; text: string };
	canImprove: boolean;
	improve: () => void;
	/** Marks the next report as the result of a toolbar command or link, so it's saved even after focus moved. */
	command: () => void;
};

let active: ActiveEditor | null = null;
const listeners = new Set<() => void>();
const setActive = (next: ActiveEditor | null) => {
	active = next;
	for (const listener of listeners) listener();
};
const subscribe = (listener: () => void) => {
	listeners.add(listener);
	return () => listeners.delete(listener);
};
const useActiveEditor = () => useSyncExternalStore(subscribe, () => active);

/** The editor's serialisation of the value it holds; edits are measured against it. */
const loadBaseline = (
	ref: RefObject<EnrichedTextInputInstance | null>,
	session: RichTextSession,
	write: (html: string) => void,
) =>
	void ref.current
		?.getHTML()
		.then((html) => {
			const held = session.baseline(html);
			if (held !== null) write(held);
		})
		.catch(() => undefined);

type RichTextFieldProps = {
	label: string;
	value: string;
	/** Receives resume HTML, only after the user edits this field. `newStep` marks an accepted AI replacement. */
	onChange: (html: string, options?: { newStep?: boolean }) => void;
	/** Guidance while editing, e.g. "2–3 sentences reads best". */
	hint?: string | undefined;
	disabled?: boolean | undefined;
	autoFocus?: boolean | undefined;
};

/**
 * Rich text (react-native-enriched-html). The toolbar docks above the keyboard while the field has focus; render
 * `RichTextToolbar` once on the screen. Only an edited field is re-serialised (README §0).
 */
export function RichTextField({ label, value, onChange, hint, disabled = false, autoFocus }: RichTextFieldProps) {
	const { t } = useLingui();
	const { colors, fonts, radius, space, type } = useTheme();
	const ref = useRef<EnrichedTextInputInstance>(null);
	const [session] = useState(() => createRichTextSession(value));
	const [focused, setFocused] = useState(false);
	const border = focused ? 2 : 1;
	const [text, setText] = useState("");
	const [improving, setImproving] = useState<{ index: number; text: string } | null>(null);
	const plain = useRef("");
	const editor = useRef<ActiveEditor | null>(null);
	// Table markup can't be edited safely by the native editor; it stays as it is.
	const readOnly = useMemo(() => /<table[\s>]/i.test(value), [value]);
	const editable = !disabled && !readOnly;

	const readBaseline = () => loadBaseline(ref, session, onChange);

	// Undo, Page's Fit and remote updates change the text from outside; load them while the field isn't focused.
	useEffect(() => {
		const markup = session.external(value);
		if (markup === null) return;
		ref.current?.setValue(markup);
		readBaseline();
	});

	useEffect(() => {
		loadBaseline(ref, session, () => undefined);
		return () => {
			if (active?.ref === ref) setActive(null);
		};
	}, [session]);

	const publish = (change: Partial<ActiveEditor>) => {
		if (!editor.current) return;
		editor.current = { ...editor.current, ...change };
		if (editor.current.focused || active?.ref === ref) setActive(editor.current);
	};

	const startImprove = () => {
		const line = lineAtCaret(plain.current, editor.current?.selection.start ?? 0);
		if (line) setImproving(line);
	};

	return (
		<View style={{ gap: space.s1 }}>
			<Text variant="label">{label}</Text>
			{readOnly ? (
				<Text variant="caption" color="ink2">
					{t`Original table formatting is preserved. This content is read-only because it cannot be edited safely.`}
				</Text>
			) : null}
			<View
				style={{
					borderWidth: border,
					borderRadius: radius.rLg,
					borderColor: focused ? colors.accent : colors.lineStrong,
					backgroundColor: editable ? colors.raised : colors.sunken,
					overflow: "hidden",
				}}
			>
				<EnrichedTextInput
					ref={ref}
					accessibilityLabel={label}
					// The initial markup only: changing defaultValue reloads the editor and moves the caret.
					defaultValue={session.markup}
					editable={editable}
					autoFocus={autoFocus ?? false}
					placeholderTextColor={colors.ink3}
					cursorColor={colors.accent}
					selectionColor={colors.accentSoft}
					linkRegex={null}
					style={{
						minHeight: type.bodyLarge.lineHeight * 4 + space.s3 * 2 - border * 2,
						maxHeight: 360 - border * 2,
						paddingHorizontal: space.s3 - (border - 1),
						paddingVertical: space.s3 - (border - 1),
						color: colors.ink,
						fontFamily: fonts.ui[400],
						fontSize: type.bodyLarge.fontSize,
					}}
					htmlStyle={{
						a: { color: colors.accentText, textDecorationLine: "underline" },
						code: { color: colors.ink, backgroundColor: colors.sunken },
						ul: { bulletColor: colors.ink2 },
						ol: { markerColor: colors.ink2 },
					}}
					onFocus={() => {
						session.focus();
						resumeFieldFocus.onFocus();
						setFocused(true);
						readBaseline();
						editor.current = {
							ref,
							focused: true,
							state: editor.current?.state ?? null,
							selection: editor.current?.selection ?? { start: 0, end: 0, text: "" },
							canImprove: lineAtCaret(plain.current, editor.current?.selection.start ?? 0) !== null,
							improve: startImprove,
							command: session.command,
						};
						setActive(editor.current);
					}}
					onBlur={() => {
						session.blur();
						resumeFieldFocus.onBlur();
						setFocused(false);
						publish({ focused: false });
					}}
					onChangeHtml={(event) => {
						const html = session.change(event.nativeEvent.value);
						if (html !== null) onChange(html);
					}}
					onChangeText={(event) => {
						plain.current = event.nativeEvent.value;
						setText(event.nativeEvent.value);
					}}
					onChangeState={(event) => publish({ state: event.nativeEvent })}
					onChangeSelection={(event) => {
						const selection = event.nativeEvent;
						publish({
							selection,
							canImprove: lineAtCaret(plain.current, selection.start) !== null,
							improve: startImprove,
						});
					}}
				/>
			</View>
			{focused || improving ? (
				<View style={{ flexDirection: "row", justifyContent: "space-between", gap: space.s3 }}>
					<Text variant="caption" color="ink3" style={{ flex: 1 }}>
						{hint ?? ""}
					</Text>
					<Text variant="mono" color="ink3">
						{plural(text.trim().length, { one: "# character", other: "# characters" })}
					</Text>
				</View>
			) : null}
			{improving ? (
				<ImprovePanel
					key={improving.index}
					line={improving}
					where={label}
					context={text}
					onClose={() => setImproving(null)}
					onReplace={async (replacement) => {
						const html = fromEnrichedHtml((await ref.current?.getHTML()) ?? "");
						const next = replaceLine(html, improving.index, improving.text, replacement);
						if (next === null) return false;
						onChange(next, { newStep: true });
						ref.current?.setValue(session.wrote(next));
						setImproving(null);
						return true;
					}}
				/>
			) : null}
		</View>
	);
}

type ToolbarButton = { key: string; icon: IconName; label: string; isActive: boolean | undefined; run: () => void };

/**
 * The formatting toolbar above the keyboard: bold, italic, underline, strikethrough, lists, link, text style,
 * Improve, and Done pinned at the end. It scrolls sideways when it doesn't fit.
 */
export function RichTextToolbar() {
	const { t } = useLingui();
	const { colors, size, space } = useTheme();
	const insets = useSafeAreaInsets();
	const keyboardVisible = useKeyboardVisible();
	const editor = useActiveEditor();
	const [linkOpen, setLinkOpen] = useState(false);
	const [styleOpen, setStyleOpen] = useState(false);
	const formattingScroll = useRef<ComponentRef<typeof ScrollView>>(null);
	// The last focused editor stays active after blur, so sheets keep working on it after taking focus.
	const target = () => {
		editor?.command();
		return editor?.ref.current;
	};
	const state = editor?.state;

	const heading = state?.h1.isActive ? 1 : state?.h2.isActive ? 2 : state?.h3.isActive ? 3 : 0;
	const buttons: ToolbarButton[] = [
		{ key: "b", icon: "text-b", label: t`Bold`, isActive: state?.bold.isActive, run: () => target()?.toggleBold() },
		{
			key: "i",
			icon: "text-italic",
			label: t`Italic`,
			isActive: state?.italic.isActive,
			run: () => target()?.toggleItalic(),
		},
		{
			key: "ul",
			icon: "list-bullets",
			label: t`Bulleted list`,
			isActive: state?.unorderedList.isActive,
			run: () => target()?.toggleUnorderedList(),
		},
		{
			key: "ol",
			icon: "list-numbers",
			label: t`Numbered list`,
			isActive: state?.orderedList.isActive,
			run: () => target()?.toggleOrderedList(),
		},
		{
			key: "a",
			icon: "link-simple-horizontal",
			label: t`Link`,
			isActive: state?.link.isActive,
			run: () => setLinkOpen(true),
		},
		{
			key: "h",
			icon: "text-aa",
			label: t`Text style`,
			isActive: heading > 0,
			run: () => setStyleOpen(true),
		},
	];
	const marks: ToolbarButton[] = [
		{
			key: "u",
			icon: "text-underline",
			label: t`Underline`,
			isActive: state?.underline.isActive,
			run: () => target()?.toggleUnderline(),
		},
		{
			key: "s",
			icon: "text-strikethrough",
			label: t`Strikethrough`,
			isActive: state?.strikeThrough.isActive,
			run: () => target()?.toggleStrikeThrough(),
		},
	];

	const setHeading = (level: number) => {
		const input = target();
		if (!input) return;
		const toggle = (which: number) => {
			if (which === 1) input.toggleH1();
			if (which === 2) input.toggleH2();
			if (which === 3) input.toggleH3();
		};
		// Off with the current heading, then on with the new one ("Paragraph" is just off).
		if (level !== heading) {
			if (heading) toggle(heading);
			if (level) toggle(level);
		}
		setStyleOpen(false);
		input.focus();
	};

	return (
		<>
			{editor?.focused ? (
				<View
					accessibilityRole="toolbar"
					accessibilityLabel={t`Formatting`}
					style={{
						flexDirection: "row",
						alignItems: "center",
						minHeight: size.hit + space.s1 * 2 + (keyboardVisible ? 0 : insets.bottom),
						paddingBottom: keyboardVisible ? 0 : insets.bottom,
						borderTopWidth: 1,
						borderTopColor: colors.line,
						backgroundColor: colors.raised,
					}}
				>
					<ScrollView
						ref={formattingScroll}
						horizontal
						keyboardShouldPersistTaps="always"
						persistentScrollbar
						onLayout={() => formattingScroll.current?.flashScrollIndicators()}
					>
						<View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: space.s1 }}>
							{buttons.map((button) => (
								<IconButton
									key={button.key}
									icon={button.icon}
									label={button.label}
									selected={button.isActive ?? false}
									onPress={button.run}
								/>
							))}
						</View>
					</ScrollView>
					<View style={{ borderStartWidth: 1, borderStartColor: colors.line }}>
						<IconButton
							icon="sparkle"
							label={t`Improve selected line`}
							disabled={!editor.canImprove}
							onPress={editor.improve}
						/>
					</View>
					<Button variant="link" label={t`Done`} onPress={() => editor?.ref.current?.blur()} />
					<View style={{ width: space.s3 }} />
				</View>
			) : null}
			<PromptSheet
				open={linkOpen}
				title={t`Link address`}
				message={t`Leave it empty to remove the link.`}
				initialValue="https://"
				keyboardType="url"
				onClose={() => setLinkOpen(false)}
				onSubmit={(href) => {
					setLinkOpen(false);
					const input = target();
					const selection = editor?.selection;
					if (!input || !selection) return;
					const url = href.trim();
					if (!url || url === "https://") input.removeLink(selection.start, selection.end);
					else input.setLink(selection.start, selection.end, selection.text || url, url);
					input.focus();
				}}
			/>
			<Sheet open={styleOpen} onClose={() => setStyleOpen(false)} title={t`Text style`}>
				{marks.map((mark) => (
					<ListRow
						key={mark.key}
						title={mark.label}
						leading={mark.icon}
						selected={mark.isActive ?? false}
						onPress={() => {
							mark.run();
							setStyleOpen(false);
							editor?.ref.current?.focus();
						}}
					/>
				))}
				{[
					{ level: 0, icon: "paragraph" as const, label: t`Paragraph` },
					{ level: 1, icon: "text-h-one" as const, label: t`Heading 1` },
					{ level: 2, icon: "text-h-two" as const, label: t`Heading 2` },
					{ level: 3, icon: "text-h-three" as const, label: t`Heading 3` },
				].map((option) => (
					<ListRow
						key={option.level}
						title={option.label}
						leading={option.icon}
						selected={heading === option.level}
						onPress={() => setHeading(option.level)}
					/>
				))}
			</Sheet>
		</>
	);
}
