import { t } from "@lingui/core/macro";
// J5 · Save a job (a full-screen modal; also the share-sheet target, which opens it with the link filled in).
// Fields fill with a d2 crossfade once the posting is read; Applied reveals the application date and what was sent.
import * as Clipboard from "expo-clipboard";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { Platform, View } from "react-native";
import { sentStepHref } from "./actions";
import { isLink } from "./model";
import { FadeIn } from "./parts";
import { storyboard } from "./storyboard";
import {
	ensureApproved,
	providerConnection,
	queueJobCopy,
	useAIProviders,
	useApplicationActions,
	useApplications,
	useDocuments,
} from "@/data";
import {
	Button,
	FieldRow,
	FooterBar,
	Form,
	haptic,
	Icon,
	IconTile,
	layout,
	ListRow,
	PushScreen,
	Segmented,
	showToast,
	Text,
	TextField,
	TextLink,
} from "@/ui";

type Stage = "saved" | "applied" | "interview";

export function SaveJobScreen() {
	const params = useLocalSearchParams<{
		url?: string;
		role?: string;
		company?: string;
		location?: string;
		shared?: string;
	}>();
	const [link, setLink] = useState(params.url ?? "");
	const [role, setRole] = useState(params.role ?? "");
	const [company, setCompany] = useState(params.company ?? "");
	const [location, setLocation] = useState(params.location ?? "");
	const [stage, setStage] = useState<Stage>("saved");
	const [more, setMore] = useState(false);
	const [salary, setSalary] = useState("");
	const [clipboardLink, setClipboardLink] = useState(false);
	// Read from the link: on open from the share sheet (params), or with Read posting / Read with AI.
	const [readDone, setReadDone] = useState(false);
	const [reading, setReading] = useState(false);
	const [readFailed, setReadFailed] = useState(false);
	const [clipped, setClipped] = useState(false);
	const read = readDone || (!!params.url && !!(params.role || params.company));
	const missing = read && (!role.trim() || !company.trim());
	// ponytail: the count is known once the posting is parsed; until J5 parses on open, only the storyboard has one.
	const requirementCount = storyboard?.postingRequirements ?? 0;
	const actions = useApplicationActions();
	const router = useRouter();
	const applications = useApplications();
	const documents = useDocuments({ type: "resume" });
	const providers = useAIProviders();
	const provider = providers.data?.find((p) => p.isDefault && p.enabled) ?? providers.data?.find((p) => p.enabled);
	// Duplicate check: the same posting link is already tracked.
	const duplicate = isLink(link) ? applications.data?.find((app) => app.sourceUrl === link.trim()) : undefined;

	const readPosting = async (useAI: boolean) => {
		// The first posting sent to an AI connection asks first (S7); reading without AI sends nothing.
		if (useAI && (!provider || !(await ensureApproved("posting", providerConnection(provider))))) return;
		setReading(true);
		setReadFailed(false);
		try {
			const posting = await actions.parsePosting(link.trim(), useAI);
			setRole((current) => posting.role || current);
			setCompany((current) => posting.company || current);
			setLocation((current) => posting.location || current);
			setClipped(posting.postingSource?.completeness === "incomplete");
			setReadDone(true);
		} catch {
			haptic("error");
			setReadFailed(true);
		} finally {
			setReading(false);
		}
	};

	useEffect(() => {
		if (link) return;
		// Only asks whether a link is there; the text is read when the person taps Paste.
		const check = Platform.OS === "ios" ? Clipboard.hasUrlAsync() : Clipboard.hasStringAsync();
		void check.then(setClipboardLink).catch(() => setClipboardLink(false));
	}, [link]);

	const paste = async () => {
		const text = (await Clipboard.getStringAsync()).trim();
		if (text) setLink(text);
	};

	const save = (prepare = false) => {
		if (!role.trim() || !company.trim()) {
			haptic("error");
			showToast({ message: t`Fill in the role and company before saving.` });
			return;
		}
		void (async () => {
			try {
				// Applied means sent: the new application starts Saved and Applied runs the "What did you send?" step.
				const id = await actions.saveJob({
					company: company.trim(),
					role: role.trim(),
					location: location.trim() || undefined,
					salary: salary.trim() || undefined,
					sourceUrl: isLink(link) ? link.trim() : undefined,
					jobDescription: isLink(link) ? undefined : link.trim() || undefined,
					status: stage === "interview" ? "interview" : "saved",
				});
				haptic("success");
				showToast({ message: t`Added ${role.trim()} at ${company.trim()}` });
				const base = documents.data?.find((doc) => doc.type === "resume");
				if (prepare && base) {
					// Save and prepare resume: a copy of the main resume, linked to this job, opens in the builder.
					const copy = await queueJobCopy({ resumeId: base.id, applicationId: id });
					router.replace(`/builder/${copy}`);
					return;
				}
				router.replace(stage === "applied" ? sentStepHref(id) : `/applications/${id}`);
			} catch {
				haptic("error");
				showToast({ message: t`Couldn't save the job. Try again.` });
			}
		})();
	};

	return (
		<PushScreen
			title={t`Save a job`}
			back="close"
			presentation="modal"
			barEnd={<Button label={t`Search postings`} tone="accentGhost" size="sm" icon="magnifying-glass" />}
			footer={
				<FooterBar stacked gap={4}>
					<Button label={t`Save job`} tone="primary" size="lg" block onPress={() => save()} testID="save-job" />
					<Button label={t`Save and prepare resume`} tone="ghost" size="lg" block onPress={() => save(true)} />
				</FooterBar>
			}
		>
			<Form>
				<View style={{ gap: 12 }}>
					<TextField
						label={t`Job link or posting text`}
						leadingIcon="link-simple"
						value={link}
						onChangeText={setLink}
						placeholder={t`Paste a link or the posting`}
						autoCapitalize="none"
						autoCorrect={false}
						keyboardType="url"
						testID="save-job-link"
						mono
					/>
					{read ? (
						<View style={{ flexDirection: "row", alignItems: "center", gap: 6 }} accessibilityRole="alert">
							<Icon
								name={missing ? "warning-circle" : "check-circle"}
								size={16}
								color={missing ? "warnText" : "accentText"}
								style={{ height: 18, justifyContent: "center" }}
							/>
							<Text variant="small" color={missing ? "warnText" : "accentText"} style={{ flexShrink: 1 }}>
								{missing
									? t`Some job details couldn't be read. Fill in the role and company, or paste one job's posting text.`
									: t`Found the role and company. Review before saving.`}
							</Text>
						</View>
					) : !link && clipboardLink ? (
						<TextLink label={t`Paste link from clipboard`} icon="link-simple" onPress={() => void paste()} />
					) : reading ? (
						<Text variant="small" color="ink3">
							{t`Reading the link…`}
						</Text>
					) : link.trim() ? (
						<View style={{ flexDirection: "row", flexWrap: "wrap", columnGap: 24 }}>
							<TextLink label={t`Read posting`} icon="link-simple" onPress={() => void readPosting(false)} />
							{provider ? (
								<TextLink label={t`Read with AI`} icon="sparkle" onPress={() => void readPosting(true)} />
							) : null}
						</View>
					) : null}
					{readFailed ? (
						<Text variant="small" color="warnText" accessibilityRole="alert">
							{t`Couldn't read this posting. Paste the posting text instead, or fill in the details.`}
						</Text>
					) : null}
					{clipped ? (
						<Text variant="small" color="warnText" accessibilityRole="alert">
							{t`This description is clipped or incomplete. Review it or paste the full description before preparing.`}
						</Text>
					) : null}
					{duplicate ? (
						<View style={{ gap: 4 }} accessibilityRole="alert">
							<Text variant="small" color="ink2">
								{t`Already tracked: ${duplicate.role} at ${duplicate.company}. Open it or update only its posting details.`}
							</Text>
							<TextLink label={t`Open tracked job`} onPress={() => router.replace(`/applications/${duplicate.id}`)} />
						</View>
					) : null}
					{params.shared ? (
						<Text variant="small" color="ink3">
							{t`Capture does not use AI. Review every field before saving.`}
						</Text>
					) : null}
				</View>
				<FadeIn key={read ? "read" : "blank"}>
					<View style={{ gap: 20 }}>
						<TextField label={t`Role`} value={role} onChangeText={setRole} />
						<FieldRow>
							<TextField grow label={t`Company`} value={company} onChangeText={setCompany} />
							<TextField grow label={t`Location`} value={location} onChangeText={setLocation} />
						</FieldRow>
					</View>
				</FadeIn>
				<View style={{ gap: 8 }}>
					<Text variant="formLabel" color="ink2">
						{t`Stage`}
					</Text>
					<Segmented<Stage>
						accessibilityLabel={t`Stage`}
						value={stage}
						onChange={setStage}
						options={[
							{ key: "saved", label: t`Saved` },
							{ key: "applied", label: t`Applied` },
							{ key: "interview", label: t`Interviewing` },
						]}
					/>
				</View>
			</Form>
			<View style={{ paddingTop: 12 }}>
				<ListRow
					title={t`What it asks for`}
					secondary={
						read && requirementCount
							? t`${requirementCount} requirements read from the posting`
							: read
								? t`Read from the posting when it's saved`
								: t`Paste the posting to read its requirements`
					}
					leading={<IconTile icon="list-checks" />}
					trailing="caret"
				/>
				<ListRow
					title={t`More details`}
					secondary={stage === "applied" ? t`Salary, application date, documents sent` : t`Salary, application date`}
					leading={<IconTile icon="plus" />}
					trailing={more ? "up" : "caret"}
					last={!more}
					boxHidden={!more}
					onPress={() => setMore((m) => !m)}
				/>
				{more ? (
					<View style={{ paddingTop: 8, paddingHorizontal: layout.screenMargin, gap: 20 }}>
						<TextField
							label={t`Salary`}
							value={salary}
							onChangeText={setSalary}
							placeholder={t`For example, €65,000 a year`}
						/>
					</View>
				) : null}
			</View>
		</PushScreen>
	);
}
