import type { Application } from "@/features/applications/types";
import type { ApplicationPacket, PacketReview, PacketSelection } from "@reactive-resume/schema/applications/autofill";
import { useLingui } from "@lingui/react/macro";
import { useQuery } from "@tanstack/react-query";
import { openBrowserAsync } from "expo-web-browser";
import { useState } from "react";
import { View } from "react-native";
import { workspaceError } from "./hooks";
import { CheckRow } from "./parts";
import { shareText } from "./share";
import { client, orpc } from "@/api/client";
import { getAccountScope, useSession } from "@/auth/session";
import { letterWords as getLetterWords } from "@/features/share/letter";
import { Button, Text, TextField, useTheme } from "@/ui";

type ApplicationPacketPanelProps = { application: Application };
export function ApplicationPacketPanel({ application }: ApplicationPacketPanelProps) {
	const session = useSession();
	const scope = getAccountScope();
	if (session.status !== "signed-in" || !scope) return null;
	return <ApplicationPacketForm key={`${scope}:${application.id}`} application={application} scope={scope} />;
}
type ApplicationPacketFormProps = ApplicationPacketPanelProps & { scope: string };
function ApplicationPacketForm({ application, scope }: ApplicationPacketFormProps) {
	const { t } = useLingui();
	const { space } = useTheme();
	const answerQuery = orpc.career.answers.list.queryOptions({ input: { applicationId: application.id } });
	const answers = useQuery({ ...answerQuery, queryKey: [...answerQuery.queryKey, scope] });
	const options = { context: { scope } };
	const [targetUrl, setTargetUrl] = useState(application.sourceUrl ?? "");
	const [includeContact, setIncludeContact] = useState(false);
	const [answerIds, setAnswerIds] = useState<string[]>([]);
	const [review, setReview] = useState<PacketReview | null>(null);
	const [packet, setPacket] = useState<ApplicationPacket | null>(null);
	const [reviewed, setReviewed] = useState(false);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState("");
	const change = (action: () => void) => {
		action();
		setReview(null);
		setPacket(null);
		setReviewed(false);
	};
	const run = async (action: () => Promise<void>) => {
		if (busy || getAccountScope() !== scope) return;
		setBusy(true);
		setError("");
		try {
			await action();
		} catch (error) {
			if (getAccountScope() === scope) {
				setReview(null);
				setReviewed(false);
				setError(workspaceError(error, t`Couldn't prepare the packet. Reload and review again.`));
			}
		} finally {
			setBusy(false);
		}
	};
	const prepare = () =>
		run(async () => {
			setPacket(null);
			setReviewed(false);
			let letterWords: PacketSelection["letterWords"] = null;
			if (application.coverLetterId) {
				const letter = await client.coverLetters.getById({ id: application.coverLetterId }, options);
				const words = await getLetterWords(letter.style.metadata.page.locale);
				letterWords = {
					locale: letter.style.metadata.page.locale,
					greeting: words.greeting("{name}"),
					teamGreeting: words.teamGreeting,
					hiringTeam: words.hiringTeam,
					signOff: words.signOff,
				};
			}
			const next = await client.applications.packet.review(
				{
					applicationId: application.id,
					targetUrl,
					includeContact,
					answerIds,
					letterWords,
				},
				options,
			);
			if (getAccountScope() === scope) setReview(next);
		});
	return (
		<View style={{ gap: space.s3 }}>
			<Text variant="heading" accessibilityRole="header">{t`Employer-form packet`}</Text>
			<Text>{t`Review a private snapshot for one form. No AI, submission or stage change. Named document versions are saved only when you approve.`}</Text>
			<Text>{t`Complete the employer form manually in your browser using reviewed answers and approved PDFs.`}</Text>
			<TextField
				label={t`Exact form URL`}
				value={targetUrl}
				editable={!busy}
				autoCapitalize="none"
				onChangeText={(value) => change(() => setTargetUrl(value))}
			/>
			<CheckRow
				label={t`Include reviewed profile name, email and phone`}
				checked={includeContact}
				disabled={busy}
				onChange={(value) => change(() => setIncludeContact(value))}
			/>
			<Text>{t`Choose saved answers to review. Unavailable evidence or another employer's scope cannot be exported.`}</Text>
			{answers.isError ? (
				<Button label={t`Retry saved answers`} onPress={() => void answers.refetch()} />
			) : answers.isPending ? (
				<Text>{t`Loading saved answers…`}</Text>
			) : (
				answers.data.map((answer) => (
					<CheckRow
						key={answer.id}
						label={answer.question}
						detail={answer.canReuse ? undefined : t`Needs evidence or scope review`}
						checked={answerIds.includes(answer.id)}
						disabled={busy || !answer.canReuse}
						onChange={(checked) =>
							change(() =>
								setAnswerIds(checked ? [...answerIds, answer.id] : answerIds.filter((value) => value !== answer.id)),
							)
						}
					/>
				))
			)}
			<Button
				variant="secondary"
				label={t`Review packet`}
				disabled={busy || !application.resumeId || !targetUrl.trim()}
				onPress={() => void prepare()}
			/>
			{review && (
				<View style={{ gap: space.s2 }}>
					<Text selectable>{review.selection.targetUrl}</Text>
					{review.contact && (
						<Text selectable>
							{Object.values(review.contact).join("\n")}
							{"\n"}
							{t`Profile review: ${review.profileReviewedAt ?? ""}`}
						</Text>
					)}
					{review.documents.map((document) => (
						<Text key={document.kind} selectable>
							{document.name}
							{"\n"}
							{t`Content revision: ${document.revision}`}
						</Text>
					))}
					<Text selectable>{review.experience}</Text>
					{review.letterText ? <Text selectable>{review.letterText}</Text> : null}
					{review.answers.map((answer) => (
						<View key={answer.id}>
							<Text>{answer.question}</Text>
							<Text selectable>{answer.answer}</Text>
							<Text variant="caption">{t`Source: ${answer.source} · scope: ${answer.scope} · revision ${answer.revision}`}</Text>
						</View>
					))}
					<CheckRow
						label={t`I reviewed these fields, answers, destination and document content.`}
						checked={reviewed}
						disabled={busy}
						onChange={setReviewed}
					/>
					<Button
						label={t`Approve and create packet`}
						disabled={!reviewed || busy || packet !== null}
						onPress={() =>
							void run(async () => {
								const next = await client.applications.packet.export(
									{
										selection: review.selection,
										fingerprint: review.fingerprint,
										reviewed: true,
									},
									options,
								);
								if (getAccountScope() === scope) setPacket(next);
							})
						}
					/>
				</View>
			)}
			{error && <Text accessibilityRole="alert">{error}</Text>}
			{packet && (
				<View style={{ gap: space.s2 }}>
					<Text accessibilityLiveRegion="polite">{t`Packet ready. Nothing submitted or marked as sent. Downloaded copies remain yours and do not refresh when source data changes.`}</Text>
					<Button
						variant="secondary"
						label={t`Download reviewed packet`}
						disabled={busy}
						onPress={() =>
							void run(() =>
								shareText("application-packet.json", JSON.stringify(packet), "application/json", "public.json"),
							)
						}
					/>
					<Button
						label={t`Open employer form in browser`}
						disabled={busy}
						onPress={() =>
							void run(async () => {
								await openBrowserAsync(packet.review.selection.targetUrl);
							})
						}
					/>
					{packet.documents.map((document) => (
						<View key={document.kind}>
							<Text selectable>
								{document.name} · {t`Version: ${document.versionId}`}
							</Text>
							<Button
								variant="secondary"
								label={t`Download approved PDF: ${document.name}`}
								disabled={busy}
								onPress={() =>
									void run(() =>
										shareText(document.filename, document.base64, "application/pdf", "com.adobe.pdf", "base64"),
									)
								}
							/>
						</View>
					))}
					{packet.review.answers.map((answer) => (
						<View key={answer.id}>
							<Text>{answer.question}</Text>
							<Text selectable>{answer.answer}</Text>
						</View>
					))}
				</View>
			)}
		</View>
	);
}
