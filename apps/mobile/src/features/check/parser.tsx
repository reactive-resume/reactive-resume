import type { CheckIssue } from "./issues";
import type { AtsResult } from "@/features/ats-checker/check";
import { plural } from "@lingui/core/macro";
import { useLingui } from "@lingui/react/macro";
import { File, Paths } from "expo-file-system";
import { useEffect, useRef, useState } from "react";
import { View } from "react-native";
import { runAtsCheck } from "@/features/ats-checker/check";
import { getPdfFindingMessage } from "@/features/ats-checker/messages";
import { Banner, Button, Card, Skeleton, Text, useTheme } from "@/ui";

type ParserProps = {
	pdf: Uint8Array | null;
	optedIn: boolean;
	visible: boolean;
	onOptIn: () => void;
	offline: boolean;
	issues: CheckIssue[];
	onSelect: (key: string) => void;
	refreshVersion: number;
};

export function Parser({ pdf, optedIn, onOptIn, offline, issues, onSelect, refreshVersion, visible }: ParserProps) {
	const { t } = useLingui();
	const { space } = useTheme();
	const [result, setResult] = useState<{
		pdf: Uint8Array;
		value: AtsResult;
		attempt: number;
		refreshVersion: number;
	} | null>(null);
	const [requestState, setRequestState] = useState<{
		pdf: Uint8Array;
		attempt: number;
		refreshVersion: number;
		pending: boolean;
		error: string | null;
	} | null>(null);
	const [attempt, setAttempt] = useState(0);
	const controller = useRef<AbortController | null>(null);
	useEffect(() => {
		if (
			!pdf ||
			!optedIn ||
			offline ||
			!visible ||
			(result?.pdf === pdf && result.attempt === attempt && result.refreshVersion === refreshVersion)
		)
			return;
		const request = new AbortController();
		controller.current = request;
		const file = new File(Paths.cache, `check-parser-${Date.now()}-${Math.random().toString(36).slice(2)}.pdf`);

		void (async () => {
			try {
				await file.write(pdf);
				if (!request.signal.aborted) {
					setRequestState({ pdf, attempt, refreshVersion, pending: true, error: null });
				}
				if (request.signal.aborted) return;
				const value = await runAtsCheck(file.uri, "resume.pdf", "", request.signal);
				if (!request.signal.aborted) setResult({ pdf, value, attempt, refreshVersion });
			} catch (error) {
				if (!request.signal.aborted)
					setRequestState({
						pdf,
						attempt,
						refreshVersion,
						pending: false,
						error: error instanceof Error ? error.message : t`Couldn't read the exported PDF.`,
					});
			} finally {
				try {
					if (file.exists) file.delete();
				} catch {
					/* OS cache eviction remains fallback. */
				}
				if (!request.signal.aborted) setRequestState((state) => state && { ...state, pending: false });
			}
		})();
		return () => request.abort();
	}, [pdf, optedIn, offline, attempt, refreshVersion, visible, result, t]);

	if (!optedIn)
		return (
			<Card style={{ gap: space.s3 }}>
				<Text>{t`The PDF is checked on the server and not stored. Send this preview to see what software reads.`}</Text>
				<Button label={t`Read the exported PDF`} disabled={offline || !pdf} onPress={onOptIn} />
			</Card>
		);
	const current = result?.pdf === pdf ? result.value : null;
	const displayed = current ?? result?.value;
	const active =
		requestState?.pdf === pdf && requestState.attempt === attempt && requestState.refreshVersion === refreshVersion;
	const pending = active && requestState.pending && !offline;
	const error = active ? requestState.error : null;
	return (
		<View style={{ gap: space.s3 }}>
			{offline && (
				<Banner tone="info" message={t`You're offline. The last PDF check stays here; connect to refresh it.`} />
			)}
			{error && (
				<Banner
					tone="danger"
					message={error}
					action={{ label: t`Retry`, onPress: () => setAttempt((value) => value + 1) }}
				/>
			)}
			{pending && (
				<>
					<Text>{t`Reading the PDF…`}</Text>
					<Button
						variant="ghost"
						label={t`Cancel`}
						onPress={() => {
							controller.current?.abort();
							setRequestState(
								(state) => state && { ...state, pending: false, error: t`PDF check canceled. Retry when ready.` },
							);
						}}
					/>
				</>
			)}
			{!pdf && <Skeleton height={space.s12} />}
			{displayed && <Parsed value={displayed} stale={!current} issues={issues} onSelect={onSelect} />}
		</View>
	);
}

type ParsedProps = { value: AtsResult; stale: boolean; issues: CheckIssue[]; onSelect: (key: string) => void };
function Parsed({ value, stale, issues, onSelect }: ParsedProps) {
	const { t } = useLingui();
	const { space } = useTheme();
	return (
		<Card style={{ gap: space.s3 }}>
			{stale && <Text color="warnText">{t`Previous PDF result. It may not match your current draft.`}</Text>}
			<Text variant="caption">{t`Extracted from the PDF on the page · reading order`}</Text>
			<Text>
				{plural(value.report.applicableChecks, {
					one: `${value.report.passedChecks} of # exported PDF check passes.`,
					other: `${value.report.passedChecks} of # exported PDF checks pass.`,
				})}
			</Text>
			{value.report.document.truncated && <Banner tone="warn" message={t`Only the first 30 pages were checked.`} />}
			{value.report.skippedChecks > 0 && (
				<Text color="ink3">
					{plural(value.report.skippedChecks, { one: "# check could not run.", other: "# checks could not run." })}
				</Text>
			)}
			{!value.fullText.trim() ? (
				<Banner tone="warn" message={t`This PDF has no text layer, so a parser reads nothing from it.`} />
			) : (
				<View style={{ gap: space.s1 }}>
					{value.fullText.split("\n").map((line, index) => {
						const issue = issues.find((issue) => {
							const text = String(issue.finding.params?.value ?? "");
							return text.trim().length > 0 && line.includes(text);
						});
						return (
							<View key={index} style={{ gap: space.s1 }}>
								<Text selectable variant="mono" color={issue ? "warnText" : "ink"}>
									{line}
								</Text>
								{issue && (
									<Button
										variant="ghost"
										label={t`Issue ${issue.number}: ${issue.title}`}
										onPress={() => onSelect(issue.key)}
									/>
								)}
							</View>
						);
					})}
				</View>
			)}
			{value.report.findings.map((finding, index) => {
				const message = getPdfFindingMessage(finding.code);
				return (
					<View key={index} style={{ gap: space.s1 }}>
						<Text variant="label">{message.title}</Text>
						<Text variant="callout" color="ink2">
							{message.action}
						</Text>
						{finding.evidence?.snippet && (
							<Text selectable variant="mono">
								{finding.evidence.snippet}
							</Text>
						)}
					</View>
				);
			})}
		</Card>
	);
}
