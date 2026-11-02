import type { AtsResult } from "./check";
import type { IconName } from "@/ui";
import type { PdfAtsReport, PdfCategory } from "@reactive-resume/resume/ats-pdf";
import type { DocumentPickerAsset } from "expo-document-picker";
import type { ReactNode } from "react";
import { plural } from "@lingui/core/macro";
import { useLingui } from "@lingui/react/macro";
import * as DocumentPicker from "expo-document-picker";
import { File, Paths } from "expo-file-system";
import { Stack, useRouter } from "expo-router";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Svg, { Circle } from "react-native-svg";
import { AtsCheckError, MAX_IMPORT_BYTES, runAtsCheck } from "./check";
import { getPdfCategoryLabel, getPdfFindingMessage } from "./messages";
import { OriginalPage } from "./original-page";
import { getServer, useSession } from "@/auth/session";
import { createReviewedResume, ImportError, importDocument } from "@/features/documents/import-file";
import { routes } from "@/routes";
import { Banner, Button, Chip, Icon, Segmented, Text, TextArea, useTheme } from "@/ui";

type PickedFile = Pick<DocumentPickerAsset, "uri" | "name" | "size" | "mimeType" | "lastModified">;

type State =
	| { name: "idle"; error?: string | undefined }
	| { name: "busy"; file: PickedFile; step: number }
	| { name: "done"; file: PickedFile; result: AtsResult; importError?: string | undefined }
	| { name: "importing" };

const MAX_POSTING = 20_000;
// The server sends no progress, so the last step starts once the upload has had a moment.
const ANALYSING_AFTER_MS = 1500;
// How long a "Fix these in the editor" press waits for sign-in before the file is forgotten.
const PENDING_IMPORT_MS = 10 * 60 * 1000;

/**
 * The public checker on a phone: pick a PDF, the server reads it (and keeps nothing), then the score, what could cost
 * a match, and the text as software reads it. "Fix these in the editor" imports the same file and opens Check.
 */
export function AtsChecker() {
	const { t } = useLingui();
	const router = useRouter();
	const session = useSession();
	const signedIn = session.status === "signed-in";
	const [state, setState] = useState<State>({ name: "idle" });
	const [posting, setPosting] = useState("");
	const abort = useRef<AbortController | null>(null);
	// Fix pressed while signed out: the import continues once sign-in returns here, on the same server, soon after.
	const pendingImport = useRef<{ file: PickedFile; server: string; at: number } | null>(null);
	const reset = () => {
		pendingImport.current = null;
		setState({ name: "idle" });
	};

	useEffect(() => () => abort.current?.abort(), []);

	const check = async (file: PickedFile) => {
		pendingImport.current = null;
		abort.current?.abort();
		const controller = new AbortController();
		abort.current = controller;
		setState({ name: "busy", file, step: 1 });
		const analysing = setTimeout(() => setState({ name: "busy", file, step: 2 }), ANALYSING_AFTER_MS);
		try {
			const result = await runAtsCheck(file.uri, file.name, posting, controller.signal);
			if (!controller.signal.aborted) setState({ name: "done", file, result });
		} catch (error) {
			if (!controller.signal.aborted)
				setState({
					name: "idle",
					error: error instanceof AtsCheckError ? error.message : t`Couldn't read that file. Try again.`,
				});
		} finally {
			clearTimeout(analysing);
		}
	};

	const choose = async () => {
		const picked = await DocumentPicker.getDocumentAsync({ type: "application/pdf", copyToCacheDirectory: true });
		const asset = picked.canceled ? undefined : picked.assets[0];
		if (asset) void check(asset);
	};

	const sample = async () => {
		try {
			const target = new File(Paths.cache, "reactive-resume-sample.pdf");
			const file = await File.downloadFileAsync(`${getServer()}/templates/pdf/onyx.pdf`, target, { idempotent: true });
			void check({ uri: file.uri, name: "Sample resume.pdf", size: file.size, lastModified: Date.now() });
		} catch {
			setState({ name: "idle", error: t`Couldn't load the sample file. Try again.` });
		}
	};

	const cancel = () => {
		abort.current?.abort();
		reset();
	};

	// A failed import goes back to the report it came from, with the reason (web checker).
	const importAndOpen = async (file: PickedFile, result?: AtsResult) => {
		setState({ name: "importing" });
		const controller = new AbortController();
		abort.current = controller;
		try {
			// Server text extraction, no AI: the same reading the check did, so every issue lines up in Check.
			const result = await importDocument(file, false, false, controller.signal);
			// Without AI nothing waits for review; a reviewed import would be created as read.
			const imported = result.type === "review" ? await createReviewedResume(result, false, controller.signal) : result;
			router.replace(routes.builder(imported.id, "check"));
		} catch (error) {
			if (controller.signal.aborted) return;
			const message =
				error instanceof ImportError ? error.message : t`Couldn't import the file. Try again from Documents.`;
			setState(result ? { name: "done", file, result, importError: message } : { name: "idle", error: message });
		}
	};

	const fix = (file: PickedFile, result: AtsResult) => {
		if (signedIn) return void importAndOpen(file, result);
		pendingImport.current = { file, server: getServer(), at: Date.now() };
		router.push(routes.signIn());
	};

	// Runs on sign-in and on a server switch: a stale, expired or other-server file is dropped, never imported.
	const resumeImport = useEffectEvent(() => {
		const pending = pendingImport.current;
		if (!pending) return;
		const valid = pending.server === getServer() && Date.now() - pending.at < PENDING_IMPORT_MS;
		if (valid && !signedIn) return;
		pendingImport.current = null;
		if (valid) void importAndOpen(pending.file);
	});
	useEffect(() => {
		resumeImport();
	}, [signedIn, session.server]);

	return (
		<SafeAreaView edges={["bottom", "left", "right"]} style={{ flex: 1 }}>
			<Stack.Screen options={{ title: state.name === "done" ? t`Report` : t`ATS checker` }} />
			{state.name === "importing" ? (
				<Importing />
			) : state.name === "busy" ? (
				<Progress name={state.file.name} step={state.step} onCancel={cancel} />
			) : state.name === "done" ? (
				<Result
					result={state.result}
					uri={state.file.uri}
					size={state.file.size ?? new File(state.file.uri).size}
					importError={state.importError}
					onFix={() => fix(state.file, state.result)}
					onReset={reset}
					onBlank={() => router.replace(routes.new())}
				/>
			) : (
				<Idle
					error={state.error}
					posting={posting}
					onPosting={setPosting}
					onChoose={() => void choose()}
					onSample={() => void sample()}
				/>
			)}
		</SafeAreaView>
	);
}

type IdleProps = {
	error?: string | undefined;
	posting: string;
	onPosting: (value: string) => void;
	onChoose: () => void;
	onSample: () => void;
};

function Idle({ error, posting, onPosting, onChoose, onSample }: IdleProps) {
	const { t } = useLingui();
	const { colors, radius, space } = useTheme();

	return (
		<ScrollView
			keyboardShouldPersistTaps="handled"
			contentInsetAdjustmentBehavior="automatic"
			contentContainerStyle={{ padding: space.s4, gap: space.s4 }}
		>
			<Text variant="display">{t`Can software read your resume?`}</Text>
			<Text color="ink2">
				{t`Upload a PDF and see the text an applicant tracking system extracts: what's missing, what's out of order, and how to fix it. Free, no account needed.`}
			</Text>
			<Pressable
				accessibilityRole="button"
				accessibilityLabel={t`Choose a PDF`}
				onPress={onChoose}
				style={({ pressed }) => ({
					alignItems: "center",
					gap: space.s2,
					padding: space.s6,
					borderRadius: radius.rLg,
					borderWidth: 1.5,
					borderStyle: "dashed",
					borderColor: colors.line2,
					backgroundColor: pressed ? colors.press : colors.surface,
				})}
			>
				<Icon name="file-arrow-up" size={28} color={colors.accentText} />
				<Text variant="title">{t`Choose a PDF`}</Text>
				<Text variant="callout" color="ink3" align="center">
					{t`Up to 25 MB · checked on the server and not stored`}
				</Text>
			</Pressable>
			{error ? <Banner tone="danger" icon="warning-circle" message={error} /> : null}
			<Button variant="ghost" label={t`Check a sample file`} onPress={onSample} />
			<TextArea
				label={t`Job posting · optional, adds a keyword match`}
				value={posting}
				onChangeText={onPosting}
				maxLength={MAX_POSTING}
				minLines={3}
				helper={t`Paste the posting to see which of its terms your resume already has.`}
			/>
		</ScrollView>
	);
}

type ProgressProps = { name: string; step: number; onCancel: () => void };

function Progress({ name, step, onCancel }: ProgressProps) {
	const { t } = useLingui();
	const { colors, radius, space } = useTheme();
	const steps = [t`Opening the file`, t`Reading the text`, t`Checking layout and content`];

	return (
		<View accessibilityLiveRegion="polite" style={{ padding: space.s4, paddingTop: space.s6, gap: space.s4 }}>
			<Text variant="heading" numberOfLines={2}>{t`Checking ${name}`}</Text>
			{steps.map((label, index) => {
				// Step 0, opening, is the local read; it is done once the upload starts.
				return (
					<View key={label} style={{ flexDirection: "row", alignItems: "center", gap: space.s3 }}>
						<View style={{ width: 22, alignItems: "center" }}>
							{index < step ? (
								<Icon name="check" size={20} color={colors.accentText} />
							) : index === step ? (
								<ActivityIndicator color={colors.accent} />
							) : (
								<View
									style={{
										width: 12,
										height: 12,
										borderRadius: radius.rSm,
										borderWidth: 1.5,
										borderColor: colors.ink3,
									}}
								/>
							)}
						</View>
						<Text color={index > step ? "ink3" : "ink"}>{label}</Text>
					</View>
				);
			})}
			<Button variant="secondary" label={t`Cancel`} onPress={onCancel} />
		</View>
	);
}

function Importing() {
	const { t } = useLingui();
	const { colors, space } = useTheme();

	return (
		<View
			accessibilityLiveRegion="polite"
			style={{ flex: 1, alignItems: "center", paddingTop: 120, padding: space.s6, gap: space.s3 }}
		>
			<ActivityIndicator size="large" color={colors.accent} />
			<Text variant="heading" align="center">{t`Importing it into your new resume…`}</Text>
			<Text color="ink2" align="center">
				{t`The editor opens on Check, which checks the imported resume again.`}
			</Text>
		</View>
	);
}

type Tone = "danger" | "warn" | "accent";
type Row = {
	key: string;
	title: string;
	count: string;
	tone: Tone;
	icon: IconName;
	findings: PdfAtsReport["findings"];
};

/** One row per category with something to fix, worst first; web's `issueRows`. */
function issueRows(report: PdfAtsReport): Row[] {
	const byCategory = new Map<PdfCategory, PdfAtsReport["findings"]>();
	for (const finding of [...report.findings, ...report.tips])
		byCategory.set(finding.category, [...(byCategory.get(finding.category) ?? []), finding]);
	const rank = { danger: 0, warn: 1, accent: 2 };
	return [...byCategory.entries()]
		.map(([category, findings]) => {
			const tone: Tone = findings.some((finding) => finding.severity === "blocker")
				? "danger"
				: findings.every((finding) => finding.severity === "tip")
					? "accent"
					: "warn";
			const icon: IconName =
				category === "content"
					? "pencil-simple"
					: tone === "danger"
						? "warning-circle"
						: tone === "warn"
							? "warning"
							: "info";
			return {
				key: category,
				title: getPdfCategoryLabel(category),
				count: String(findings.length),
				tone,
				icon,
				findings,
			};
		})
		.sort((a, b) => rank[a.tone] - rank[b.tone]);
}

type ResultProps = {
	result: AtsResult;
	uri: string;
	size: number;
	importError?: string | undefined;
	onFix: () => void;
	onReset: () => void;
	onBlank: () => void;
};

// A file with no text behind its pages has nothing to import: the editor would open empty. A partly scanned one
// (IMAGE_ONLY_DOCUMENT) still brings its readable pages.
const UNREADABLE = new Set(["NO_TEXT_LAYER"]);

function Result({ result, uri, size, importError, onFix, onReset, onBlank }: ResultProps) {
	const { t } = useLingui();
	const { colors, radius, space } = useTheme();
	const { report } = result;
	const rows = issueRows(report);
	const [open, setOpen] = useState<string | null>(report.jd ? "posting" : (rows[0]?.key ?? null));
	const [lens, setLens] = useState<"report" | "page" | "text">("report");
	const issues = report.findings.length;
	const toneColor = { danger: colors.dangerText, warn: colors.warnText, accent: colors.accentText };
	const verdict =
		report.score >= 80 ? t`Reads cleanly` : report.score >= 50 ? t`Mostly readable` : t`Hard for software to read`;
	const tooLarge = size > MAX_IMPORT_BYTES;
	const unreadable = report.findings.some((finding) => UNREADABLE.has(finding.code));
	const megabytes = Math.ceil(size / 1_000_000);

	const accordion = (key: string, title: string, count: string, icon: IconName, color: string, body: ReactNode) => {
		const expanded = open === key;
		return (
			<View key={key} style={{ borderTopWidth: 1, borderColor: colors.line }}>
				<Pressable
					accessibilityRole="button"
					accessibilityState={{ expanded }}
					onPress={() => setOpen(expanded ? null : key)}
					style={({ pressed }) => ({
						minHeight: 48,
						flexDirection: "row",
						alignItems: "center",
						gap: space.s3,
						paddingHorizontal: space.s3,
						backgroundColor: pressed ? colors.press : "transparent",
					})}
				>
					<Icon name={icon} size={20} color={color} />
					<Text variant="label" style={{ flex: 1 }}>
						{title}
					</Text>
					<Text variant="caption" color="ink3">
						{count}
					</Text>
					<Icon name="caret-down" size={18} color={colors.ink3} />
				</Pressable>
				{expanded ? (
					<View style={{ paddingHorizontal: space.s3, paddingBottom: space.s3, paddingStart: 44, gap: space.s2 }}>
						{body}
					</View>
				) : null}
			</View>
		);
	};

	return (
		<View style={{ flex: 1 }}>
			<ScrollView
				contentInsetAdjustmentBehavior="automatic"
				contentContainerStyle={{ padding: space.s4, gap: space.s4 }}
			>
				<View style={{ flexDirection: "row", alignItems: "center", gap: space.s4 }}>
					<ScoreRing score={report.score} color={report.score >= 80 ? colors.accent : colors.warn} />
					<View style={{ flex: 1, gap: space.s1 }}>
						<Text variant="title">{verdict}</Text>
						<Text variant="callout" color="ink2">
							{issues > 0
								? plural(issues, { one: "# issue could cost you a match.", other: "# issues could cost you a match." })
								: t`Nothing here should cost you a match.`}{" "}
							{t`The score reflects how reliably text is extracted, not your chances.`}
						</Text>
					</View>
				</View>

				{report.document.truncated ? (
					<Banner
						tone="info"
						icon="info"
						title={t`Only the first ${report.document.pageCount} pages were checked.`}
						message={t`The rest of the file isn't in this report.`}
					/>
				) : null}

				<Segmented
					label={t`How to show the file`}
					value={lens}
					onChange={setLens}
					options={[
						{ value: "report", label: t`Report` },
						{ value: "page", label: t`What a person sees` },
						{ value: "text", label: t`What a parser reads` },
					]}
				/>

				{lens === "report" ? (
					<>
						<View
							style={{
								borderRadius: radius.rLg,
								borderWidth: 1,
								borderTopWidth: 0,
								borderColor: colors.line,
								overflow: "hidden",
							}}
						>
							{report.jd
								? accordion(
										"posting",
										t`Terms from the posting`,
										`${report.jd.matchedCount}/${report.jd.totalTerms}`,
										"list-checks",
										colors.warnText,
										report.jd.totalTerms === 0 ? (
											<Text variant="callout" color="ink2">
												{t`No specific terms could be pulled out of that job description.`}
											</Text>
										) : report.jd.missingTerms.length === 0 ? (
											<Text variant="callout" color="ink2">
												{t`Every term the posting stresses is already there.`}
											</Text>
										) : (
											<>
												<Text variant="callout" color="ink2">{t`Not found:`}</Text>
												<View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.s2 }}>
													{report.jd.missingTerms.map((term) => (
														<Chip key={term} label={term} />
													))}
												</View>
												{report.jd.matchedTerms.length > 0 ? (
													<>
														<Text variant="callout" color="ink2">{t`Already covered:`}</Text>
														<View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.s2 }}>
															{report.jd.matchedTerms.map((term) => (
																<Chip key={term} label={term} selected />
															))}
														</View>
													</>
												) : null}
												<Text variant="caption" color="ink3">
													{t`Counted separately from the parse score. Coverage does not predict anything.`}
												</Text>
											</>
										),
									)
								: null}
							{rows.map((row) =>
								accordion(
									row.key,
									row.title,
									row.key === "content" ? t`${row.count} · Not scored` : row.count,
									row.icon,
									toneColor[row.tone],
									row.findings.map((finding) => {
										const message = getPdfFindingMessage(finding.code);
										return (
											<View key={finding.code} style={{ gap: space.s0 }}>
												<Text variant="label">{message.title}</Text>
												<Text variant="callout" color="ink2">
													{message.action}
												</Text>
											</View>
										);
									}),
								),
							)}
						</View>
						<Text variant="caption" color="ink3">
							{t`This measures how faithfully software can extract this file's text. It does not predict whether an application will be rejected, and no tool can.`}
						</Text>
						<Button variant="ghost" label={t`Check another file`} onPress={onReset} fullWidth />
					</>
				) : lens === "page" ? (
					<OriginalPage uri={uri} />
				) : (
					<ScrollView
						horizontal
						style={{
							borderRadius: radius.rLg,
							borderWidth: 1,
							borderColor: colors.line,
							backgroundColor: colors.raised,
						}}
					>
						<Text variant="mono" selectable style={{ padding: space.s4 }}>
							{result.fullText || t`No text could be read from this file.`}
						</Text>
					</ScrollView>
				)}
			</ScrollView>

			<View
				style={{
					padding: space.s4,
					gap: space.s2,
					borderTopWidth: 1,
					borderColor: colors.line,
					backgroundColor: colors.surface,
				}}
			>
				{importError ? <Banner tone="danger" message={importError} /> : null}
				{unreadable ? (
					<>
						<Banner
							tone="warn"
							icon="warning"
							title={t`There's no text here to bring into the editor`}
							message={t`Start a blank resume and paste your sections in, or import the Word version instead.`}
						/>
						<View style={{ flexDirection: "row", gap: space.s2 }}>
							<View style={{ flex: 1 }}>
								<Button variant="secondary" label={t`Check another file`} onPress={onReset} fullWidth />
							</View>
							<View style={{ flex: 1 }}>
								<Button label={t`Start blank`} onPress={onBlank} fullWidth />
							</View>
						</View>
					</>
				) : tooLarge ? (
					<>
						<Banner
							tone="warn"
							icon="warning"
							title={t`This file is ${megabytes} MB. Imports take files up to 10 MB.`}
							message={t`Export a smaller PDF and check it again, or start a blank resume and fix these there.`}
						/>
						<View style={{ flexDirection: "row", gap: space.s2 }}>
							<View style={{ flex: 1 }}>
								<Button variant="secondary" label={t`Check another file`} onPress={onReset} fullWidth />
							</View>
							<View style={{ flex: 1 }}>
								<Button label={t`Start blank`} onPress={onBlank} fullWidth />
							</View>
						</View>
					</>
				) : (
					<Button label={t`Fix these in the editor`} onPress={onFix} fullWidth />
				)}
			</View>
		</View>
	);
}

type ScoreRingProps = { score: number; color: string };

function ScoreRing({ score, color }: ScoreRingProps) {
	const { t } = useLingui();
	const { colors } = useTheme();
	const size = 84;
	const stroke = 7;
	const r = (size - stroke) / 2;
	const circumference = 2 * Math.PI * r;

	return (
		<View
			accessible
			accessibilityRole="image"
			accessibilityLabel={t`Readability score: ${score} out of 100`}
			style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}
		>
			<Svg width={size} height={size} style={{ position: "absolute", transform: [{ rotate: "-90deg" }] }}>
				<Circle cx={size / 2} cy={size / 2} r={r} stroke={colors.sunken} strokeWidth={stroke} fill="none" />
				<Circle
					cx={size / 2}
					cy={size / 2}
					r={r}
					stroke={color}
					strokeWidth={stroke}
					fill="none"
					strokeLinecap="round"
					strokeDasharray={`${circumference} ${circumference}`}
					strokeDashoffset={circumference * (1 - Math.min(100, Math.max(0, score)) / 100)}
				/>
			</Svg>
			<Text variant="heading">{String(score)}</Text>
		</View>
	);
}
