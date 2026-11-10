// B4 · Description and Improve, also the Summary editor (Summary skips B2). Reading-size lines (16/26); the line being
// improved dims and its suggestion sits under the text with only the changed words marked. The formatting bar is
// 52 pt with 44 pt buttons on a 52 pt pitch; Improve opens a short menu of line actions.
import { t } from "@lingui/core/macro";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Anchor, useAnchoredMenu, useAnchorRef } from "../shared/anchored-menu";
import { BuilderScreen, editResume, useBuilderParams, useLocked, useResumeData, useSaveWord } from "../shared/document";
import { entryTitle, findEntry, getEntries, resolveSection, sectionName } from "../shared/model";
import { useBuilderStoryboard } from "../shared/storyboard";
import {
	type ImproveAction,
	type Proposal,
	NoConnectionError,
	NotApprovedError,
	actionName,
	improveLine,
} from "./improve";
import { type Line, parseLines, serializeLines, toggleWrap } from "./lines";
import { resumeFieldFocus, useAIProviders, useResumeStore } from "@/data";
import { STORYBOARD } from "@/dev/storyboard/harness";
import {
	Button,
	Dialog,
	FormattingToolbar,
	haptic,
	HeroCard,
	IconButton,
	ProposalText,
	showToast,
	Text,
	TextField,
	type as typeScale,
	useTheme,
	WorkingLabel,
} from "@/ui";

type Ask =
	| { status: "idle" }
	| { status: "working"; index: number; action: ImproveAction; request?: string | undefined }
	| { status: "ready"; index: number; proposal: Proposal; changed?: boolean }
	| { status: "failed"; index: number; action: ImproveAction; request?: string | undefined };

export function DescriptionScreen() {
	const params = useBuilderParams();
	const { improve: openImprove } = useLocalSearchParams<{ improve?: string }>();
	const router = useRouter();
	const insets = useSafeAreaInsets();
	const { colors } = useTheme();
	const data = useResumeData();
	const locked = useLocked();
	const word = useSaveWord();
	const providers = useAIProviders();
	const preset = useBuilderStoryboard((s) => s.proposal);
	const menu = useAnchoredMenu();
	const improveRef = useAnchorRef();
	const [focused, setFocused] = useState<number | null>(null);
	const [last, setLast] = useState(0);
	const [ask, setAsk] = useState<Ask>({ status: "idle" });
	const [question, setQuestion] = useState<null | { action: "result" | "custom" | "link"; value: string }>(null);
	const abort = useRef<AbortController | null>(null);
	const visit = useRef(0);

	const summary = params.section === "summary";
	const section = data ? resolveSection(data, params.section) : null;
	const entry = !summary && data ? findEntry(data, params.section, params.item) : undefined;
	const field = section?.type === "summary" || section?.type === "cover-letter" ? "content" : "description";
	const html = summary
		? (data?.summary.content ?? "")
		: String((entry as Record<string, unknown> | undefined)?.[field] ?? "");
	const lines = parseLines(html);
	const title = summary || !section ? t`Summary` : t`Description`;

	useEffect(() => {
		if (preset)
			setAsk({
				status: "ready",
				index: preset.lineIndex,
				proposal: {
					line: lines[preset.lineIndex]?.text ?? "",
					text: preset.parts.map((p) => p.text).join(""),
					action: preset.action as ImproveAction,
					parts: preset.parts,
				},
			});
		// eslint-disable-next-line react-hooks/exhaustive-deps -- a storyboard preset applies once
	}, [preset]);

	const write = (next: Line[], options: { key?: string } = {}) => {
		const value = serializeLines(next);
		editResume(
			(d) => {
				if (summary) d.summary.content = value;
				else {
					const s = resolveSection(d, params.section);
					const target =
						s && (getEntries(d, s).find((e) => e.id === params.item) as Record<string, unknown> | undefined);
					if (target) target[field] = value;
				}
			},
			options.key ? { coalesceKey: options.key, sameStep: true } : { newStep: true },
		);
	};

	const setLine = (index: number, patch: Partial<Line>, key?: string) =>
		write(
			lines.map((line, i) => (i === index ? { ...line, ...patch } : line)),
			key ? { key } : {},
		);

	const run = async (index: number, action: ImproveAction, request?: string) => {
		const line = lines[index];
		if (!line?.text.trim()) return;
		abort.current?.abort();
		const controller = new AbortController();
		abort.current = controller;
		setAsk({ status: "working", index, action, request });
		try {
			const where = [title, entry && section ? entryTitle(section.type, entry) : ""].filter(Boolean).join(" · ");
			const proposal = await improveLine({
				providers: providers.data ?? [],
				line: line.text,
				action,
				request,
				where,
				context: lines.map((l) => l.text).join("\n"),
				signal: controller.signal,
			});
			if (controller.signal.aborted) return;
			setAsk({ status: "ready", index, proposal });
		} catch (error) {
			if (controller.signal.aborted) return;
			if (error instanceof NoConnectionError) {
				setAsk({ status: "idle" });
				router.push("/settings/ai/providers/new");
				return;
			}
			if (error instanceof NotApprovedError) {
				setAsk({ status: "idle" });
				return;
			}
			haptic("error");
			setAsk({ status: "failed", index, action, request });
		}
	};

	const target = focused ?? last;
	const openMenu = () =>
		menu.open(improveRef, [
			{ label: t`Shorter`, onPress: () => void run(target, "shorter") },
			{ label: t`Stronger verb`, onPress: () => void run(target, "verb") },
			{ label: t`Add a result`, onPress: () => setQuestion({ action: "result", value: "" }) },
			{ label: t`Tie to the posting`, onPress: () => void run(target, "posting") },
			{ label: t`Ask for something else…`, onPress: () => setQuestion({ action: "custom", value: "" }) },
		]);

	// "Improve" on B3's description card lands here with the menu open.
	const opened = useRef(false);
	useEffect(() => {
		if (openImprove && !opened.current && lines.length > 0) {
			opened.current = true;
			setTimeout(openMenu, 350);
		}
	});

	const replace = () => {
		if (ask.status !== "ready") return;
		const current = lines[ask.index];
		if (!current || current.text !== ask.proposal.line) {
			setAsk({ ...ask, changed: true });
			return;
		}
		setLine(ask.index, { text: ask.proposal.text, html: undefined });
		haptic("light");
		setAsk({ status: "idle" });
		showToast({
			message: t`Line replaced`,
			action: { label: t`Undo`, onPress: () => useResumeStore.getState().undo() },
		});
	};

	const toolbar = [
		{
			icon: "text-b" as const,
			label: t`Bold`,
			onPress: () => lines[target] && setLine(target, { html: toggleWrap(lines[target], "strong") }),
		},
		{
			icon: "text-italic" as const,
			label: t`Italic`,
			onPress: () => lines[target] && setLine(target, { html: toggleWrap(lines[target], "em") }),
		},
		{
			icon: "list-bullets" as const,
			label: t`Bulleted list`,
			onPress: () => lines[target] && setLine(target, { list: !lines[target].list }),
		},
		{ icon: "link-simple" as const, label: t`Link`, onPress: () => setQuestion({ action: "link", value: "" }) },
	];

	const card =
		ask.status === "idle" ? null : (
			<HeroCard
				keyLine={ask.status === "ready" ? t`Suggestion · ${actionName(ask.proposal.action)}` : undefined}
				keyIcon="sparkle"
			>
				<View style={{ marginTop: -8, gap: 12 }}>
					{ask.status === "working" ? (
						<View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
							<WorkingLabel steps={[t`Improving…`, t`Still working`]} />
							<Button
								label={t`Stop`}
								tone="ghost"
								onPress={() => {
									abort.current?.abort();
									haptic("light");
									setAsk({ status: "idle" });
								}}
							/>
						</View>
					) : ask.status === "failed" ? (
						<>
							<Text variant="body" color="ink2">
								{t`Couldn't get a suggestion. Nothing changed.`}
							</Text>
							<Button label={t`Try again`} onPress={() => void run(ask.index, ask.action, ask.request)} />
						</>
					) : (
						<>
							<ProposalText
								parts={ask.proposal.parts.map((p) => ({ text: p.text, kind: p.added ? "added" : "same" }))}
							/>
							<Text variant="ui" color="ink3">
								{ask.changed ? t`The line changed since you asked, so it wasn't replaced.` : t`Check it's accurate.`}
							</Text>
							<View style={{ marginTop: 4, flexDirection: "row", alignItems: "center", gap: 12 }}>
								<Button label={t`Replace`} tone="primary" onPress={replace} style={{ alignSelf: "center" }} />
								<Button
									label={t`Keep mine`}
									tone="ghost"
									onPress={() => setAsk({ status: "idle" })}
									style={{ alignSelf: "center" }}
								/>
								<View style={{ flex: 1 }} />
								<IconButton
									icon="arrows-clockwise"
									label={t`Try another`}
									iconSize={20}
									onPress={() => void run(ask.index, ask.proposal.action)}
								/>
							</View>
						</>
					)}
				</View>
			</HeroCard>
		);

	const improving = ask.status === "working" || ask.status === "ready" ? ask.index : -1;
	return (
		<BuilderScreen
			barCenter={
				<Text variant="topBarTitle" numberOfLines={1} accessibilityRole="header">
					{summary && data && section ? sectionName(data, section) : title}
				</Text>
			}
			status={word}
			subtitle={null}
			barEnd={<Button label={t`Done`} size="sm" tone="accentGhost" onPress={() => router.back()} />}
			overlay={
				<>
					{menu.menu}
					<Dialog
						open={!!question}
						onClose={() => setQuestion(null)}
						title={
							question?.action === "result"
								? t`What changed because of this?`
								: question?.action === "link"
									? t`Link address`
									: t`Ask for something else…`
						}
						actions={[
							{
								label: question?.action === "link" ? t`Add link` : t`Ask`,
								tone: "primary",
								onPress: () => {
									const q = question;
									setQuestion(null);
									if (!q?.value.trim()) return;
									if (q.action === "link") {
										const line = lines[target];
										if (line)
											setLine(target, {
												html: `<a href="${q.value.trim().replace(/"/g, "&quot;")}">${line.html ?? escape(line.text)}</a>`,
											});
									} else void run(target, q.action, q.value.trim());
								},
							},
							{ label: t`Cancel`, tone: "secondary", onPress: () => setQuestion(null) },
						]}
					>
						<TextField
							value={question?.value ?? ""}
							onChangeText={(value) => setQuestion((q) => (q ? { ...q, value } : q))}
							autoFocus
							{...(question?.action === "link"
								? { keyboardType: "url" as const, autoCapitalize: "none" as const }
								: {})}
						/>
					</Dialog>
				</>
			}
			footer={
				<View style={{ backgroundColor: colors.raised, paddingBottom: insets.bottom }}>
					<View>
						<FormattingToolbar items={toolbar} />
						<View style={{ position: "absolute", top: 1, bottom: 0, end: 12, justifyContent: "center" }}>
							<Anchor anchorRef={improveRef}>
								<Button
									label={t`Improve`}
									icon="sparkle"
									size="sm"
									tone="accentGhost"
									onPress={openMenu}
									disabled={locked}
								/>
							</Anchor>
						</View>
					</View>
				</View>
			}
		>
			<View style={{ paddingTop: 24, paddingHorizontal: 24, gap: 12 }}>
				{lines.map((line, index) => (
					<View key={index} style={{ flexDirection: "row" }}>
						<View style={{ width: 20, alignItems: "flex-start", paddingTop: 11 }}>
							{line.list ? (
								<View
									style={{
										width: 5,
										height: 5,
										borderRadius: 3,
										marginStart: 4,
										backgroundColor: colors[improving === index ? "ink3" : "ink"],
									}}
								/>
							) : null}
						</View>
						{focused === index && !STORYBOARD ? (
							<TextInput
								value={line.text}
								multiline
								autoFocus
								editable={!locked}
								submitBehavior="submit"
								selectionColor={colors.accent}
								onChangeText={(text) =>
									setLine(index, { text, html: undefined }, `${params.item}.line.${index}:${visit.current}`)
								}
								onSubmitEditing={() => {
									const next = [...lines];
									next.splice(index + 1, 0, { text: "", list: line.list });
									write(next);
									setFocused(index + 1);
								}}
								onKeyPress={(e) => {
									if (e.nativeEvent.key === "Backspace" && !line.text && lines.length > 1) {
										write(lines.filter((_, i) => i !== index));
										setFocused(Math.max(0, index - 1));
									}
								}}
								onFocus={() => {
									visit.current++;
									resumeFieldFocus.onFocus();
								}}
								onBlur={() => {
									resumeFieldFocus.onBlur();
									setFocused((f) => (f === index ? null : f));
								}}
								style={[typeScale.prose, { flex: 1, padding: 0, color: colors.ink }]}
							/>
						) : (
							<Text
								variant="prose"
								color={improving === index ? "ink3" : "ink"}
								style={{ flex: 1 }}
								onPress={
									locked
										? undefined
										: () => {
												setFocused(index);
												setLast(index);
											}
								}
							>
								{line.text}
							</Text>
						)}
					</View>
				))}
				{lines.length === 0 && !locked ? (
					<Text variant="prose" color="ink3" onPress={() => write([{ text: "", list: !summary }])}>
						{summary ? t`2–3 sentences reads best` : t`Description`}
					</Text>
				) : null}
			</View>
			{card}
		</BuilderScreen>
	);
}

const escape = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
