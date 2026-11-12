// B9 · Check and B10 · Job match: Issues · Job match · Writing. Issues: the score as one big number with its label
// and a plain sentence, one card per open issue with exactly one fix, passing checks folded into one row, and the
// exported-PDF check. Job match: which posting, one count (never a percentage), missing terms with one Add each, then
// "Already covered".
import type { ResumeData } from "@reactive-resume/schema/resume/data";
import type { BottomTabNavigationProp } from "expo-router/js-tabs";
import { plural, t } from "@lingui/core/macro";
import { useLocalSearchParams, useNavigation, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { View } from "react-native";
import { createEntry } from "@reactive-resume/resume/entries";
import {
	BuilderScreen,
	editResume,
	useBuilderParams,
	useLocked,
	useResumeData,
	useResumeDocument,
	useSaveWord,
} from "../shared/document";
import { type CheckIssue, buildIssues, categoryName, openLine, verdictLabel } from "./issues";
import { type MatchedTerm, useJobMatch } from "./job-match";
import { useCheckReport } from "./report";
import { useApplications, usePDFATSCheck, useResumeStore } from "@/data";
import { pageRenderer } from "@/render/page-renderer";
import {
	BigNumber,
	BottomSheet,
	Button,
	Card,
	Dialog,
	haptic,
	Icon,
	IconButton,
	IconTile,
	IssueMarker,
	ListRow,
	RowLink,
	SectionHeading,
	Segmented,
	SheetScrollView,
	showToast,
	Spinner,
	Text,
	TextField,
	TextLink,
	Touch,
} from "@/ui";

type View3 = "issues" | "job" | "writing";
const undo = () => ({ label: t`Undo`, onPress: () => useResumeStore.getState().undo() });

function IssueCard({
	issue,
	onFix,
	onMore,
	locked,
}: {
	issue: CheckIssue;
	onFix: () => void;
	onMore: () => void;
	locked: boolean;
}) {
	return (
		// The card isn't one accessibility element: its Fix button must stay reachable. The heading opens the sheet.
		<Touch onPress={onMore} onLongPress={onMore} feedback="none" accessible={false}>
			<Card>
				<View
					accessible
					accessibilityRole="button"
					accessibilityLabel={t`Issue ${issue.number}: ${issue.title}`}
					accessibilityActions={[{ name: "longpress", label: t`Actions` }]}
					onAccessibilityAction={onMore}
					onAccessibilityTap={onMore}
					style={{ flexDirection: "row", alignItems: "center", gap: 12 }}
				>
					<IssueMarker n={issue.number} />
					<Text variant="rowTitle" weight={600} style={{ flexShrink: 1 }}>
						{issue.title}
					</Text>
				</View>
				{issue.body ? (
					<Text variant="body" color="ink2">
						{issue.body}
					</Text>
				) : null}
				{locked ? null : <Button label={issue.fix.label} onPress={onFix} />}
			</Card>
		</Touch>
	);
}

export function CheckScreen() {
	const { id } = useBuilderParams();
	const params = useLocalSearchParams<{ view?: string }>();
	const router = useRouter();
	const data = useResumeData();
	const document = useResumeDocument();
	const locked = useLocked();
	const word = useSaveWord();
	const { report, verdict } = useCheckReport(data ?? undefined);
	const pdfCheck = usePDFATSCheck();
	const applications = useApplications();
	const [view, setView] = useState<View3>(
		params.view === "job" ? "job" : params.view === "writing" ? "writing" : "issues",
	);
	const navigation = useNavigation<BottomTabNavigationProp<{ check: undefined }>>();
	useEffect(
		() =>
			navigation.addListener("tabPress", () => {
				setView("issues");
				router.setParams({ view: undefined });
			}),
		[navigation, router],
	);
	const [sheet, setSheet] = useState<CheckIssue | null>(null);
	const [explain, setExplain] = useState(false);
	const [passing, setPassing] = useState(false);
	const [termSheet, setTermSheet] = useState<MatchedTerm | null>(null);
	const [picker, setPicker] = useState(false);
	const [pasting, setPasting] = useState<string | null>(null);
	const [chosen, setChosen] = useState<string | null>(null);
	const [pasted, setPasted] = useState("");
	const applicationId = chosen ?? document?.applicationId ?? null;
	const match = useJobMatch(data, applicationId, pasted);

	if (!data || !report)
		return (
			<BuilderScreen docked title={t`Check`}>
				{null}
			</BuilderScreen>
		);
	const issues = buildIssues(report, data);

	const fix = (issue: CheckIssue) => {
		if (issue.fix.kind === "write") {
			const target = issue.fix.target;
			router.push(
				target.kind === "basics"
					? `/builder/${id}/basics`
					: target.kind === "section"
						? `/builder/${id}/section/${target.sectionId}`
						: `/builder/${id}/section/${target.sectionId}/${target.itemId}`,
			);
			return;
		}
		const { apply } = issue.fix;
		editResume((d) => apply(d as ResumeData));
		haptic(issues.length === 1 ? "success" : "light");
		showToast({ message: t`Issue resolved`, action: undo() });
	};
	const ignore = (issue: CheckIssue) =>
		editResume((d) => {
			d.metadata.check ??= { ignored: [], hiddenTerms: [] };
			d.metadata.check.ignored.push(issue.key);
		});

	const checkPdf = async () => {
		try {
			const render = await pageRenderer.render({ kind: "resume", id, revision: `check:${Date.now()}`, data });
			const result = await pdfCheck.mutateAsync({
				uri: render.pdfFile,
				name: "resume.pdf",
				signal: new AbortController().signal,
			});
			const problems = result.report.findings?.length ?? 0;
			showToast({
				message: problems
					? t`Exported PDF checked: ${problems} more to look at.`
					: t`Exported PDF checked: it reads cleanly too.`,
			});
		} catch {
			haptic("error");
			showToast({ message: t`The exported PDF couldn't be checked. Try again.` });
		}
	};

	const addToSkills = (term: MatchedTerm) => {
		editResume((d) => {
			const skill = createEntry("skills") as ResumeData["sections"]["skills"]["items"][number];
			skill.name = term.label;
			d.sections.skills.items.push(skill);
		});
		haptic("light");
		showToast({ message: t`${term.label} added to Skills`, action: undo() });
	};
	const hideTerm = (term: MatchedTerm) => {
		editResume((d) => {
			d.metadata.check ??= { ignored: [], hiddenTerms: [] };
			d.metadata.check.hiddenTerms.push(term.term);
		});
		haptic("light");
		showToast({ message: t`${term.label} hidden`, action: undo() });
	};

	const categories = Object.entries(report.categories).filter(([, c]) => c.total > 0);
	const issuesView = (
		<>
			<View style={{ paddingTop: 24, paddingHorizontal: 24, flexDirection: "row", alignItems: "center", gap: 16 }}>
				<Touch
					onPress={() => setExplain(true)}
					feedback="none"
					accessibilityLabel={t`Readability score: ${report.score} out of 100`}
				>
					<BigNumber count>{String(report.score)}</BigNumber>
				</Touch>
				<View style={{ gap: 2 }}>
					<Text variant="label">{verdict ?? verdictLabel(report)}</Text>
					<Text variant="ui" color="ink3">
						{openLine(issues.length)}
					</Text>
				</View>
			</View>
			<View style={{ paddingTop: 20, paddingHorizontal: 24, gap: 12 }}>
				{issues.map((issue) => (
					<IssueCard
						key={issue.key}
						issue={issue}
						locked={locked}
						onFix={() => fix(issue)}
						onMore={() => setSheet(issue)}
					/>
				))}
			</View>
			<View style={{ paddingTop: 12 }}>
				<ListRow
					title={plural(report.passedRules, { one: "# check passed", other: "# checks passed" })}
					leading={<Icon name="check-circle" size={24} color="ink2" />}
					trailing={passing ? "up" : "caret"}
					// B9 draws this row as a plain line, not a list row.
					boxHidden
					last={!passing}
					onPress={() => setPassing((p) => !p)}
				/>
				{passing
					? categories.map(([category, score], i) => (
							<ListRow
								key={category}
								title={categoryName(category as never)}
								secondary={t`${score.passed} of ${score.total} pass`}
								leading={<View style={{ width: 24 }} />}
								last={i === categories.length - 1}
							/>
						))
					: null}
			</View>
			{report.ignored.length > 0 && !locked ? (
				<View style={{ paddingHorizontal: 24, paddingTop: 12 }}>
					<TextLink
						label={t`Show them again`}
						onPress={() =>
							editResume((d) => {
								if (d.metadata.check) d.metadata.check.ignored = [];
							})
						}
					/>
				</View>
			) : null}
			<View style={{ paddingHorizontal: 24, paddingTop: 20, flexDirection: "row", alignItems: "center", gap: 8 }}>
				{pdfCheck.isPending ? <Spinner /> : null}
				<TextLink
					label={pdfCheck.isPending ? t`Checking the exported PDF…` : t`Check the exported PDF`}
					onPress={pdfCheck.isPending ? undefined : () => void checkPdf()}
				/>
			</View>
		</>
	);

	const result = match.result;
	const linked = !!applicationId || !!pasted;
	const jobView = (
		<>
			{linked ? (
				<View style={{ paddingTop: 12 }}>
					<ListRow
						title={
							match.application ? `${match.application.company} · ${match.application.role}` : t`Pasted job posting`
						}
						secondary={
							chosen
								? t`Posting from the chosen application`
								: applicationId
									? t`Posting from the linked application`
									: t`Pasted for this visit`
						}
						trailing={
							<Touch
								onPress={() => setPicker(true)}
								feedback="none"
								accessibilityLabel={t`Change`}
								style={{ paddingStart: 16 }}
							>
								<Text variant="ui" color="ink3">
									{t`Change`}
								</Text>
							</Touch>
						}
						last
						trailingAction
						onPress={() => (applicationId ? router.push(`/applications/${applicationId}`) : setPicker(true))}
					/>
				</View>
			) : (
				<View style={{ paddingTop: 12 }}>
					<ListRow title={t`Link an application…`} trailing="caret" onPress={() => setPicker(true)} />
					<ListRow title={t`Paste a job posting…`} trailing="caret" last onPress={() => setPasting("")} />
				</View>
			)}
			{match.reading || match.loading ? (
				<View style={{ paddingTop: 16, paddingHorizontal: 24, flexDirection: "row", alignItems: "center", gap: 8 }}>
					<Spinner />
					<Text variant="ui" color="ink3">
						{t`Reading the posting…`}
					</Text>
				</View>
			) : result && result.total === 0 ? (
				<Text variant="body" color="ink3" style={{ paddingTop: 16, paddingHorizontal: 24 }}>
					{t`No terms stood out in this posting.`}
				</Text>
			) : result ? (
				<>
					<View style={{ paddingTop: 16, paddingHorizontal: 24, gap: 2 }}>
						<BigNumber>{t`${result.found.length} of ${result.total}`}</BigNumber>
						<Text variant="ui" color="ink3">
							{t`posting terms are already in your resume`}
						</Text>
					</View>
					{result.missing.length > 0 ? (
						<>
							<SectionHeading title={t`Not in your resume yet`} />
							<View style={{ paddingHorizontal: 24 }}>
								<Text variant="ui" color="ink3">
									{t`Add a term only if it's true for you.`}
								</Text>
							</View>
							{result.missing.map((term, i) => (
								<ListRow
									key={term.term}
									title={term.label}
									last={i === result.missing.length - 1}
									boxHidden={i === result.missing.length - 1}
									trailing={locked ? undefined : <RowLink label={t`Add`} onPress={() => setTermSheet(term)} />}
								/>
							))}
						</>
					) : null}
					{result.found.length > 0 ? (
						<>
							<SectionHeading title={t`Already covered`} />
							{result.found.map((term, i) => (
								<ListRow
									key={term.term}
									title={term.label}
									last={i === result.found.length - 1}
									onPress={() => router.push(`/builder/${id}/preview?term=${encodeURIComponent(term.term)}`)}
								/>
							))}
						</>
					) : null}
				</>
			) : null}
		</>
	);

	const writingView = (
		<View style={{ paddingTop: 20, paddingHorizontal: 24, gap: 16 }}>
			<Text variant="body" color="ink2">
				{t`Writing suggestions come from the assistant and aren't part of the score.`}
			</Text>
			<Button
				label={t`Review the writing`}
				icon="sparkle"
				onPress={() =>
					router.push(`/builder/${id}/assistant?prompt=${encodeURIComponent(t`Review the writing in my resume.`)}`)
				}
			/>
		</View>
	);

	return (
		<BuilderScreen
			docked
			clipDump
			title={t`Check`}
			status={word}
			subtitle={null}
			barEnd={
				<>
					<IconButton icon="sparkle" label={t`Assistant`} onPress={() => router.push(`/builder/${id}/assistant`)} />
					<IconButton icon="dots-three" label={t`More`} onPress={() => router.push(`/builder/${id}/menu`)} />
				</>
			}
			overlay={
				<>
					<Dialog
						open={explain}
						onClose={() => setExplain(false)}
						title={verdict ?? verdictLabel(report)}
						message={t`The score counts how reliably software reads your resume. It doesn't predict whether you'll be shortlisted.`}
						actions={[{ label: t`Close`, tone: "secondary", onPress: () => setExplain(false) }]}
					/>
					{sheet ? (
						<BottomSheet title={sheet.title} height={320} onClose={() => setSheet(null)}>
							{[
								...(locked
									? []
									: [{ key: "fix", label: sheet.fix.label, icon: "check" as const, run: () => fix(sheet) }]),
								{
									key: "show",
									label: t`Show on page`,
									icon: "file-text" as const,
									run: () => router.push(`/builder/${id}/preview?issue=${sheet.number}`),
								},
								...(locked
									? []
									: [{ key: "ignore", label: t`Ignore`, icon: "eye-slash" as const, run: () => ignore(sheet) }]),
							].map((row, i, all) => (
								<ListRow
									key={row.key}
									title={row.label}
									leading={<IconTile icon={row.icon} />}
									top={i === 0}
									last={i === all.length - 1}
									onPress={() => {
										setSheet(null);
										row.run();
									}}
								/>
							))}
						</BottomSheet>
					) : null}
					{termSheet ? (
						<BottomSheet title={termSheet.label} height={320} onClose={() => setTermSheet(null)}>
							<ListRow
								title={t`Add to Skills`}
								leading={<IconTile icon="plus" />}
								top
								onPress={() => {
									setTermSheet(null);
									addToSkills(termSheet);
								}}
							/>
							<ListRow
								title={t`Ask the assistant to work it in`}
								leading={<IconTile icon="sparkle" accent />}
								onPress={() => {
									setTermSheet(null);
									router.push(
										`/builder/${id}/assistant?prompt=${encodeURIComponent(t`Work “${termSheet.label}” into my resume where it's true.`)}`,
									);
								}}
							/>
							<ListRow
								title={t`Not true for me`}
								leading={<IconTile icon="eye-slash" />}
								last
								onPress={() => {
									setTermSheet(null);
									hideTerm(termSheet);
								}}
							/>
						</BottomSheet>
					) : null}
					{picker ? (
						<BottomSheet title={t`Link an application`} height={520} onClose={() => setPicker(false)}>
							<SheetScrollView>
								{(applications.data ?? []).map((app, i, all) => (
									<ListRow
										key={app.id}
										title={app.company}
										secondary={app.role}
										top={i === 0}
										last={i === all.length - 1}
										onPress={() => {
											setPicker(false);
											setPasted("");
											setChosen(app.id);
										}}
									/>
								))}
								<ListRow
									title={t`Paste a job posting…`}
									trailing="caret"
									last
									onPress={() => {
										setPicker(false);
										setPasting("");
									}}
								/>
							</SheetScrollView>
						</BottomSheet>
					) : null}
					<Dialog
						open={pasting !== null}
						onClose={() => setPasting(null)}
						title={t`Paste a job posting`}
						actions={[
							{
								label: t`Match`,
								tone: "primary",
								onPress: () => {
									setChosen(null);
									setPasted(pasting ?? "");
									setPasting(null);
								},
							},
							{ label: t`Cancel`, tone: "secondary", onPress: () => setPasting(null) },
						]}
					>
						<TextField value={pasting ?? ""} onChangeText={setPasting} multiline minHeight={160} autoFocus />
					</Dialog>
				</>
			}
		>
			<View style={{ paddingTop: view === "job" ? 20 : 16, paddingHorizontal: 24 }}>
				<Segmented<View3>
					options={[
						{ key: "issues", label: t`Issues` },
						{ key: "job", label: t`Job match` },
						{ key: "writing", label: t`Writing` },
					]}
					value={view}
					onChange={(next) => {
						setView(next);
						router.setParams({ view: next === "issues" ? undefined : next });
					}}
					accessibilityLabel={t`Check views`}
				/>
			</View>
			{view === "issues" ? issuesView : view === "job" ? jobView : writingView}
		</BuilderScreen>
	);
}
