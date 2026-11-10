import { t } from "@lingui/core/macro";
// J5 · Save a job (a full-screen modal; also the share-sheet target, which opens it with the link filled in).
// Fields fill with a d2 crossfade once the posting is read; Applied reveals the application date and what was sent.
import * as Clipboard from "expo-clipboard";
import { useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { Platform, View } from "react-native";
import { FadeIn } from "./parts";
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
	const read = !!params.url && !!(params.role || params.company);
	const missing = read && (!role.trim() || !company.trim());

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

	const save = () => {
		if (!role.trim() || !company.trim()) {
			haptic("error");
			showToast({ message: t`Fill in the role and company before saving.` });
			return;
		}
		// Creating the application goes through the data layer's create action (requested from the lead); Applied then
		// runs the "What did you send?" step for the new application, and prepare opens D3's Copy a resume for a job.
		showToast({ message: t`Couldn't save the job. Try again.` });
	};

	return (
		<PushScreen
			title={t`Save a job`}
			back="close"
			presentation="modal"
			barEnd={<Button label={t`Search postings`} tone="accentGhost" size="sm" icon="magnifying-glass" />}
			footer={
				<FooterBar stacked gap={4}>
					<Button label={t`Save job`} tone="primary" size="lg" block onPress={save} testID="save-job" />
					<Button label={t`Save and prepare resume`} tone="ghost" size="lg" block onPress={save} />
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
					/>
					{read ? (
						<View style={{ flexDirection: "row", alignItems: "center", gap: 6 }} accessibilityRole="alert">
							<Icon
								name={missing ? "warning-circle" : "check-circle"}
								size={16}
								color={missing ? "warnText" : "accentText"}
							/>
							<Text variant="small" color={missing ? "warnText" : "accentText"} style={{ flex: 1 }}>
								{missing
									? t`Some job details couldn't be read. Fill in the role and company, or paste one job's posting text.`
									: t`Found the role and company. Review before saving.`}
							</Text>
						</View>
					) : !link && clipboardLink ? (
						<TextLink label={t`Paste link from clipboard`} icon="link-simple" onPress={() => void paste()} />
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
					secondary={read ? t`Read from the posting when it's saved` : t`Paste the posting to read its requirements`}
					leading={<IconTile icon="list-checks" />}
					trailing="caret"
				/>
				<ListRow
					title={t`More details`}
					secondary={stage === "applied" ? t`Salary, application date, documents sent` : t`Salary, application date`}
					leading={<IconTile icon="plus" />}
					trailing={more ? "up" : "caret"}
					last={!more}
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
