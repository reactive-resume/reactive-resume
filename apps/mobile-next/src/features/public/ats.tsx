import { t } from "@lingui/core/macro";
import * as DocumentPicker from "expo-document-picker";
import { useEffect, useRef, useState } from "react";
import { View } from "react-native";
import { pdfVerdict } from "@reactive-resume/resume/ats-pdf";
import { getPdfFindingMessage } from "./ats-messages";
import { usePDFATSCheck } from "@/data";
import {
	Button,
	HeroCard,
	Icon,
	IconTile,
	ListRow,
	PushScreen,
	SectionHeading,
	Text,
	WorkingLabel,
	haptic,
} from "@/ui";

export function ATSCheckerScreen() {
	const check = usePDFATSCheck();
	const controller = useRef<AbortController | null>(null);
	const active = useRef(true);
	const [error, setError] = useState<string | null>(null);
	const [read, setRead] = useState(false);
	useEffect(
		() => () => {
			active.current = false;
			controller.current?.abort();
		},
		[],
	);
	const choose = async () => {
		try {
			const result = await DocumentPicker.getDocumentAsync({
				type: "application/pdf",
				copyToCacheDirectory: true,
				multiple: false,
			});
			const file = result.canceled ? null : result.assets[0];
			if (!file) return;
			if ((file.size ?? 0) > 25_000_000) {
				setError(t`That file is too large to check. PDFs up to 25 MB work.`);
				return;
			}
			controller.current?.abort();
			const request = new AbortController();
			controller.current = request;
			setError(null);
			try {
				await check.mutateAsync({ uri: file.uri, name: file.name, signal: request.signal });
				if (active.current) haptic("success");
			} catch (e) {
				if (active.current && !request.signal.aborted) {
					setError(e instanceof Error ? e.message : t`Couldn't read that file. Try again.`);
					haptic("error");
				}
			}
		} catch {
			setError(t`Couldn't open that file. Try again.`);
		}
	};
	const report = check.data?.report;
	const verdict = report ? pdfVerdict(report).verdict : null;
	return (
		<PushScreen title={t`ATS checker`} subtitle={t`See how hiring software reads any resume. Nothing is saved.`}>
			{report ? (
				<View style={{ padding: 24, gap: 16 }}>
					<Text variant="bigNumber">{report.score}</Text>
					<Text variant="heading">
						{verdict === "clean"
							? t`Reads cleanly`
							: verdict === "mostly"
								? t`Mostly readable`
								: t`Hard for software to read`}
					</Text>
					<Text variant="body">{t`${report.passedChecks} checks passed · ${report.skippedChecks} couldn't run`}</Text>
					<Button label={t`Choose another PDF`} onPress={() => void choose()} />
					<Button label={read ? t`Show issues` : t`What a parser reads`} onPress={() => setRead(!read)} />
					{read ? (
						<Text variant="prose">{check.data?.fullText}</Text>
					) : (
						report.findings.map((finding, i) => {
							const copy = getPdfFindingMessage(finding.code);
							return (
								<View key={`${finding.code}-${i}`} style={{ gap: 8 }}>
									<Text variant="label">{copy.title}</Text>
									<Text variant="body">{copy.action}</Text>
								</View>
							);
						})
					)}
				</View>
			) : (
				<HeroCard dashed style={{ paddingVertical: 36, minHeight: 218 }}>
					{check.isPending ? (
						<View style={{ height: 144, justifyContent: "center", gap: 24 }}>
							<WorkingLabel steps={[t`Opening the file`, t`Reading the text`, t`Checking layout and content`]} />
							<Button
								label={t`Stop`}
								onPress={() => {
									controller.current?.abort();
									check.reset();
								}}
							/>
						</View>
					) : (
						<View style={{ alignItems: "center", gap: 12, marginTop: -8 }}>
							<Icon name="file-pdf" size={40} color="ink3" />
							<Text variant="heading">{t`Choose a PDF`}</Text>
							<Button
								label={t`Choose a PDF`}
								size="lg"
								tone="primary"
								block
								style={{ marginTop: 8 }}
								onPress={() => void choose()}
							/>
						</View>
					)}
				</HeroCard>
			)}
			{error ? (
				<View style={{ padding: 24, gap: 12 }}>
					<Text variant="body" color="dangerText">
						{error}
					</Text>
					<Button label={t`Try again`} onPress={() => void choose()} />
				</View>
			) : null}
			<SectionHeading title={t`What it checks`} />
			<ListRow leading={<IconTile icon="text-aa" />} title={t`Text can be read`} secondary={t`Not an image of text`} />
			<ListRow
				leading={<IconTile icon="list-dashes" />}
				title={t`Sections are found`}
				secondary={t`Experience, education, skills`}
			/>
			<ListRow
				leading={<IconTile icon="calendar-blank" />}
				title={t`Dates and titles parse`}
				secondary={t`Each role reads as one entry`}
			/>
			<ListRow
				leading={<IconTile icon="at" />}
				title={t`Contact details come through`}
				secondary={t`Email, phone, links`}
				last
			/>
		</PushScreen>
	);
}
