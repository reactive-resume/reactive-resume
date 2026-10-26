import type { RouterInput } from "@/api/client";
import { useLingui } from "@lingui/react/macro";
import { useState } from "react";
import { View } from "react-native";
import { client } from "@/api/client";
import { getAccountScope, getServer } from "@/auth/session";
import { Button, SelectSheet, Sheet, Text, TextArea, showToast, useTheme } from "@/ui";

type Report = RouterInput["ai"]["reportContent"];
type ReportAiContentProps = { source: Exclude<Report["source"], "public-resume">; text?: string };

export function ReportAiContent({ source, text = "" }: ReportAiContentProps) {
	const { t } = useLingui();
	const [open, setOpen] = useState(false);
	return (
		<>
			<Button
				size="sm"
				variant="link"
				icon="warning-circle"
				label={t`Report AI content`}
				onPress={() => setOpen(true)}
			/>
			<Sheet open={open} onClose={() => setOpen(false)} title={t`Report AI content`}>
				{open ? <AiReportForm source={source} initialContent={text} onSent={() => setOpen(false)} /> : null}
			</Sheet>
		</>
	);
}

type AiReportFormProps = { source: Report["source"]; initialContent?: string; onSent: () => void };

export function AiReportForm({ source, initialContent = "", onSent }: AiReportFormProps) {
	const { t } = useLingui();
	const { space } = useTheme();
	const [content, setContent] = useState(initialContent.slice(0, 20_000));
	const [note, setNote] = useState("");
	const [reason, setReason] = useState<Report["reason"]>("other");
	const [busy, setBusy] = useState(false);
	const send = async () => {
		const scope = getAccountScope();
		if (!scope || busy || !content.trim()) return;
		setBusy(true);
		try {
			await client.ai.reportContent({ source, content, note, reason }, { context: { scope } });
			onSent();
			showToast({ message: t`Report received by your server operator. Thank you.` });
		} catch {
			showToast({ message: t`Couldn't send the report. Your text is kept; try again.` });
		} finally {
			setBusy(false);
		}
	};
	return (
		<View style={{ gap: space.s3 }}>
			<Text color="ink2">{t`Only the text below and your reason are sent privately to the operator of ${getServer()} for safety review. Remove personal information you don't want to share. Reports are deleted with your account.`}</Text>
			<TextArea
				label={t`Content to report`}
				value={content}
				onChangeText={setContent}
				maxLength={20_000}
				editable={!busy}
			/>
			<SelectSheet
				label={t`Reason`}
				value={reason}
				onChange={setReason}
				disabled={busy}
				options={[
					{ value: "hate", label: t`Hate or harassment` },
					{ value: "sexual", label: t`Sexual content` },
					{ value: "violence", label: t`Violence or abuse` },
					{ value: "dangerous", label: t`Dangerous or illegal advice` },
					{ value: "other", label: t`Other concern` },
				]}
			/>
			<TextArea
				label={t`Additional details (optional)`}
				value={note}
				onChangeText={setNote}
				maxLength={1_000}
				editable={!busy}
			/>
			<Button
				label={busy ? t`Sending…` : t`Send report`}
				disabled={busy || !content.trim()}
				onPress={() => void send()}
			/>
		</View>
	);
}
