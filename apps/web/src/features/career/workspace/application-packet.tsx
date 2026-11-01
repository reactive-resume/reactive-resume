import type { Application } from "@/features/applications/types";
import type { ApplicationPacket, PacketReview, PacketSelection } from "@reactive-resume/schema/applications/autofill";
import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useQuery } from "@tanstack/react-query";
import { useId, useState } from "react";
import { Button } from "@reactive-resume/ui/components/button";
import { Checkbox } from "@reactive-resume/ui/components/checkbox";
import { Input } from "@reactive-resume/ui/components/input";
import { Textarea } from "@reactive-resume/ui/components/textarea";
import { downloadWithAnchor } from "@reactive-resume/utils/file";
import { createLetterWordsForLocale } from "@/features/letters/compose";
import { getReadableErrorMessage } from "@/libs/error-message";
import { client, orpc } from "@/libs/orpc/client";

type ApplicationPacketPanelProps = { application: Application };
export function ApplicationPacketPanel({ application }: ApplicationPacketPanelProps) {
	const id = useId();
	const answers = useQuery(orpc.career.answers.list.queryOptions({ input: { applicationId: application.id } }));
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
		setBusy(true);
		setError("");
		try {
			await action();
		} catch (error) {
			setReview(null);
			setReviewed(false);
			setError(getReadableErrorMessage(error, t`Couldn't prepare the packet. Reload and review again.`));
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
				const letter = await client.coverLetters.getById({ id: application.coverLetterId });
				const words = await createLetterWordsForLocale(letter.style.metadata.page.locale);
				letterWords = {
					locale: letter.style.metadata.page.locale,
					greeting: words.greeting("{name}"),
					teamGreeting: words.teamGreeting,
					hiringTeam: words.hiringTeam,
					signOff: words.signOff,
				};
			}
			setReview(
				await client.applications.packet.review({
					applicationId: application.id,
					targetUrl,
					includeContact,
					answerIds,
					letterWords,
				}),
			);
		});
	const approve = () =>
		run(async () => {
			if (!review || !reviewed) return;
			setPacket(
				await client.applications.packet.export({
					selection: review.selection,
					fingerprint: review.fingerprint,
					reviewed: true,
				}),
			);
		});
	return (
		<section aria-label={t`Employer-form packet`} className="grid gap-3 border-t border-line py-4 text-sm">
			<h3 className="font-semibold">
				<Trans>Employer-form packet</Trans>
			</h3>
			<p>
				<Trans>
					Review a private snapshot for one form. No AI, submission or stage change. Named document versions are saved
					only when you approve.
				</Trans>
			</p>
			<p>
				<Trans>
					Browser autofill is experimental: only verified native controls can be filled. Unknown authorization,
					sensitive questions, custom controls, account steps, captcha and additional pages need your explicit answers
					or manual completion.
				</Trans>
			</p>
			<fieldset disabled={busy} className="grid gap-3">
				<label htmlFor={`${id}-url`} className="grid gap-1">
					<Trans>Exact form URL</Trans>
					<Input
						id={`${id}-url`}
						type="url"
						value={targetUrl}
						onChange={(event) => change(() => setTargetUrl(event.target.value))}
					/>
				</label>
				<label htmlFor={`${id}-contact`} className="flex gap-2">
					<Checkbox
						id={`${id}-contact`}
						checked={includeContact}
						onCheckedChange={(value) => change(() => setIncludeContact(value))}
					/>
					<Trans>Include reviewed profile name, email and phone</Trans>
				</label>
				<p>
					<Trans>
						Choose saved answers to review. Unavailable evidence or another employer's scope cannot be exported.
					</Trans>
				</p>
				{answers.isError ? (
					<Button variant="secondary" onClick={() => void answers.refetch()}>
						<Trans>Retry saved answers</Trans>
					</Button>
				) : answers.isPending ? (
					<p role="status">
						<Trans>Loading saved answers…</Trans>
					</p>
				) : (
					answers.data.map((answer) => (
						<label key={answer.id} htmlFor={`${id}-${answer.id}`} className="flex gap-2">
							<Checkbox
								id={`${id}-${answer.id}`}
								disabled={!answer.canReuse}
								checked={answerIds.includes(answer.id)}
								onCheckedChange={(checked) =>
									change(() =>
										setAnswerIds(
											checked ? [...answerIds, answer.id] : answerIds.filter((value) => value !== answer.id),
										),
									)
								}
							/>
							{answer.question}
							{!answer.canReuse && (
								<span>
									<Trans>Needs evidence or scope review</Trans>
								</span>
							)}
						</label>
					))
				)}
				<Button
					variant="secondary"
					disabled={!application.resumeId || !targetUrl.trim()}
					onClick={() => void prepare()}
				>
					<Trans>Review packet</Trans>
				</Button>
				{review && (
					<div className="grid gap-3 rounded-lg border border-line p-3">
						<p className="break-all">{review.selection.targetUrl}</p>
						{review.contact && (
							<p className="whitespace-pre-wrap">
								{Object.values(review.contact).join("\n")}
								<br />
								{t`Profile review: ${review.profileReviewedAt ?? ""}`}
							</p>
						)}
						{review.documents.map((document) => (
							<p key={document.kind} className="break-all">
								{document.name} · {t`Content revision: ${document.revision}`}
							</p>
						))}
						<pre className="whitespace-pre-wrap">{review.experience}</pre>
						{review.letterText && <pre className="whitespace-pre-wrap">{review.letterText}</pre>}
						{review.answers.map((answer) => (
							<div key={answer.id}>
								<p>{answer.question}</p>
								<p className="whitespace-pre-wrap">{answer.answer}</p>
								<p>{t`Source: ${answer.source} · scope: ${answer.scope} · revision ${answer.revision}`}</p>
							</div>
						))}
						<label htmlFor={`${id}-review`} className="flex gap-2">
							<Checkbox id={`${id}-review`} checked={reviewed} onCheckedChange={setReviewed} />
							<Trans>I reviewed these fields, answers, destination and document content.</Trans>
						</label>
						<Button disabled={!reviewed || packet !== null} onClick={() => void approve()}>
							<Trans>Approve and create packet</Trans>
						</Button>
					</div>
				)}
			</fieldset>
			{error && <p role="alert">{error}</p>}
			{packet && (
				<div className="grid gap-3">
					<p role="status">
						<Trans>
							Packet ready. Nothing submitted or marked as sent. Downloaded copies remain yours and do not refresh when
							source data changes.
						</Trans>
					</p>
					<Button
						variant="secondary"
						onClick={() =>
							downloadWithAnchor(
								new Blob([JSON.stringify(packet)], { type: "application/json" }),
								"application-packet.json",
							)
						}
					>
						<Trans>Download reviewed packet</Trans>
					</Button>
					<p>
						<Trans>
							Import this file into the browser helper, review the destination and fill report. Unsupported forms use
							exact PDF downloads and copyable answers below. Native browser integration requires its own verified
							build.
						</Trans>
					</p>
					{packet.documents.map((document) => (
						<div key={document.kind} className="grid gap-1">
							<p className="break-all">
								{document.name} · {t`Version: ${document.versionId}`}
							</p>
							<Button
								variant="secondary"
								onClick={() =>
									downloadWithAnchor(
										new Blob([Uint8Array.from(atob(document.base64), (char) => char.charCodeAt(0))], {
											type: "application/pdf",
										}),
										document.filename,
									)
								}
							>{t`Download approved PDF: ${document.name}`}</Button>
						</div>
					))}
					{packet.review.answers.map((answer) => (
						<label key={answer.id} className="grid gap-1">
							{answer.question}
							<Textarea
								readOnly
								aria-label={answer.question}
								value={answer.answer}
								className="min-h-20 rounded border border-line p-2"
							/>
						</label>
					))}
				</div>
			)}
		</section>
	);
}
