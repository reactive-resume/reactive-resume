import type { Application } from "@/features/applications/types";
import type { ApplicationPacket, PacketReview, PacketSelection } from "@reactive-resume/schema/applications/autofill";
import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useEffect, useId, useState } from "react";
import { packetTargetSchema } from "@reactive-resume/schema/applications/autofill";
import { Button } from "@reactive-resume/ui/components/button";
import { Checkbox } from "@reactive-resume/ui/components/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@reactive-resume/ui/components/dialog";
import { Icon } from "@reactive-resume/ui/components/icon";
import { Input } from "@reactive-resume/ui/components/input";
import { Textarea } from "@reactive-resume/ui/components/textarea";
import { downloadWithAnchor } from "@reactive-resume/utils/file";
import { useWorkspace } from "../hooks";
import { IconTile, ListRow } from "@/components/calm/list-row";
import { createLetterWordsForLocale } from "@/features/letters/compose";
import { getReadableErrorMessage } from "@/libs/error-message";
import { client, orpc } from "@/libs/orpc/client";

type ApplicationPacketPanelProps = { application: Application };
export function ApplicationPacketPanel({ application }: ApplicationPacketPanelProps) {
	const [open, setOpen] = useState(false);
	return (
		<>
			<ListRow
				title={t`Employer-form packet`}
				subtitle={t`Documents, contact details and answers for one form`}
				leading={
					<IconTile>
						<Icon name="clipboard-text" size={20} />
					</IconTile>
				}
				trailing={
					<Button variant="link" className="h-auto p-0 text-sm/5 text-accent-text" onClick={() => setOpen(true)}>
						<Trans>Review packet</Trans>
					</Button>
				}
			/>
			<Dialog open={open} onOpenChange={setOpen}>
				<DialogContent closeLabel={t`Close`} className="max-h-[85svh] overflow-y-auto sm:max-w-[560px]">
					<DialogHeader>
						<DialogTitle>
							<Trans>Employer-form packet</Trans>
						</DialogTitle>
					</DialogHeader>
					<PacketForm application={application} onClose={() => setOpen(false)} />
				</DialogContent>
			</Dialog>
		</>
	);
}

function PacketForm({ application, onClose }: ApplicationPacketPanelProps & { onClose: () => void }) {
	const id = useId();
	const workspace = useWorkspace(application.id);
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
		setError("");
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
	useEffect(() => {
		if (!application.resumeId || !packetTargetSchema.safeParse(targetUrl).success) return;
		let cancelled = false;
		void (async () => {
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
			const result = await client.applications.packet.review({
				applicationId: application.id,
				targetUrl,
				includeContact,
				answerIds,
				letterWords,
			});
			if (!cancelled) setReview(result);
		})()
			.catch((error) => {
				if (!cancelled)
					setError(getReadableErrorMessage(error, t`Couldn't prepare the packet. Reload and review again.`));
			})
			.finally(() => {
				if (!cancelled) setBusy(false);
			});
		return () => {
			cancelled = true;
		};
	}, [application.id, application.resumeId, application.coverLetterId, targetUrl, includeContact, answerIds]);
	const approve = () =>
		run(async () => {
			if (!review || !reviewed || busy) return;
			setPacket(
				await client.applications.packet.export({
					selection: review.selection,
					fingerprint: review.fingerprint,
					reviewed: true,
				}),
			);
		});
	return (
		<section aria-label={t`Employer-form packet`} className="grid gap-3 text-sm">
			{!packet && (
				<fieldset disabled={busy} className="grid gap-3">
					<p className="t-small text-ink-2">
						<Trans>Everything one application form asks for, checked by you and saved as it is now.</Trans>
					</p>
					<label htmlFor={`${id}-url`} className="grid gap-1.5 t-small text-ink-2">
						<Trans>The form's exact address</Trans>
						<Input
							id={`${id}-url`}
							type="url"
							value={targetUrl}
							onChange={(event) => change(() => setTargetUrl(event.target.value))}
						/>
					</label>
					<div>
						<p className="pb-1.5 t-small text-ink-2">
							<Trans>What goes in</Trans>
						</p>
						<label htmlFor={`${id}-contact`} className="flex min-h-[52px] items-center gap-3 border-y border-line py-2">
							<Checkbox
								id={`${id}-contact`}
								checked={includeContact}
								onCheckedChange={(value) => change(() => setIncludeContact(value))}
							/>
							<span className="min-w-0 flex-1">
								<span className="block">
									<Trans>Contact details</Trans>
									{review?.contact &&
										` · ${[review.contact.givenName, review.contact.familyName, review.contact.email, review.contact.phone].filter(Boolean).join(", ")}`}
								</span>
								<span className="t-small text-ink-3">
									<Trans>From your reviewed application profile</Trans>
								</span>
							</span>
							<Link to="/dashboard/settings/profile" className="t-small text-accent-text">
								<Trans>Review</Trans>
							</Link>
						</label>
						{review?.documents.map((document) => (
							<div key={document.kind} className="flex min-h-[52px] items-center gap-3 border-b border-line py-2">
								<Checkbox checked readOnly aria-label={t`${document.name} included`} />
								<span className="min-w-0 flex-1">
									<span className="block">{document.name}</span>
									<span className="t-small text-ink-3">
										{document.kind === "resume" ? t`Resume · current version` : t`Cover letter · current version`}
									</span>
								</span>
								{document.kind === "resume" ? (
									<Link
										to="/builder/$resumeId"
										params={{ resumeId: document.id }}
										target="_blank"
										className="t-small text-accent-text"
									>
										<Trans>Open</Trans>
									</Link>
								) : (
									<Link
										to="/builder/letter/$coverLetterId"
										params={{ coverLetterId: document.id }}
										target="_blank"
										className="t-small text-accent-text"
									>
										<Trans>Open</Trans>
									</Link>
								)}
							</div>
						))}
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
								<label
									key={answer.id}
									htmlFor={`${id}-${answer.id}`}
									className="flex min-h-[52px] items-center gap-3 border-b border-line py-2"
								>
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
									<span>
										<span className="block">{answer.question}</span>
										<span className={answer.canReuse ? "t-small text-ink-3" : "t-small text-warn-text"}>
											{answer.canReuse ? t`Reviewed answer` : t`Needs evidence or scope review · can't be included`}
										</span>
									</span>
								</label>
							))
						)}
						{workspace.data.answers
							.filter((answer) => !answers.data?.some((saved) => saved.question === answer.question))
							.map((answer) => (
								<div
									key={answer.id}
									className="flex min-h-[52px] items-center gap-3 border-b border-line py-2 text-ink-3"
								>
									<Checkbox disabled checked={false} />
									<span>
										<span className="block">{answer.question}</span>
										<span className="t-small text-warn-text">
											{answer.answer.trim()
												? t`Not reviewed yet · can't be included`
												: t`Not written yet · can't be included`}
										</span>
									</span>
								</div>
							))}
					</div>
					{!review && !error && packetTargetSchema.safeParse(targetUrl).success && (
						<p role="status" className="t-small text-ink-3">
							<Trans>Preparing review…</Trans>
						</p>
					)}
					{review && (
						<details className="t-small text-ink-3">
							<summary className="cursor-pointer">
								<Trans>Review included content</Trans>
							</summary>
							<div className="grid gap-3 py-2 whitespace-pre-wrap">
								<p>{review.experience}</p>
								{review.letterText && <p>{review.letterText}</p>}
								{review.answers.map((answer) => (
									<div key={answer.id}>
										<p>{answer.question}</p>
										<p>{answer.answer}</p>
										<p>{t`Source: ${answer.source} · scope: ${answer.scope} · revision ${answer.revision}`}</p>
									</div>
								))}
							</div>
						</details>
					)}
					<label htmlFor={`${id}-review`} className="flex items-center gap-3 py-1.5">
						<Checkbox id={`${id}-review`} disabled={!review || busy} checked={reviewed} onCheckedChange={setReviewed} />
						<Trans>I reviewed these fields, answers, the address and each document.</Trans>
					</label>
					<DialogFooter>
						<Button variant="ghost" onClick={onClose}>
							<Trans>Cancel</Trans>
						</Button>
						<Button disabled={!review || !reviewed || busy} loading={busy} onClick={() => void approve()}>
							<Trans>Approve and create packet</Trans>
						</Button>
					</DialogFooter>
				</fieldset>
			)}
			{error && (
				<div role="alert" className="grid gap-2">
					<p>{error}</p>
					<Button
						variant="secondary"
						disabled={!packetTargetSchema.safeParse(targetUrl).success || busy}
						onClick={() => change(() => setAnswerIds([...answerIds]))}
					>
						<Trans>Retry review</Trans>
					</Button>
				</div>
			)}
			{packet && (
				<div className="grid gap-3">
					<div role="status" className="flex items-start gap-3">
						<Icon name="check-circle" size={24} className="text-accent-text" />
						<div>
							<p className="t-label">
								<Trans>Packet ready</Trans>
							</p>
							<p className="text-[13px]/[18px] text-ink-3">
								<Trans>
									Nothing was submitted or marked as sent. Downloaded copies are yours and don't change when you edit.
								</Trans>
							</p>
						</div>
					</div>
					<div className="flex flex-wrap items-center gap-2 ps-9">
						<Button
							variant="secondary"
							onClick={() =>
								downloadWithAnchor(
									new Blob([JSON.stringify(packet)], { type: "application/json" }),
									"application-packet.json",
								)
							}
						>
							<Icon name="download-simple" />
							<Trans>Download packet</Trans>
						</Button>
						{packet.documents.map((document) => (
							<Button
								key={document.kind}
								variant="ghost"
								onClick={() =>
									downloadWithAnchor(
										new Blob([Uint8Array.from(atob(document.base64), (char) => char.charCodeAt(0))], {
											type: "application/pdf",
										}),
										document.filename,
									)
								}
								aria-label={t`Download approved PDF: ${document.name}`}
							>
								{document.kind === "resume" ? <Trans>Resume PDF</Trans> : <Trans>Letter PDF</Trans>}
							</Button>
						))}
					</div>
					<p className="ps-9 text-xs/4 text-ink-3">
						<Trans>
							The browser helper can fill plain form fields from the packet file. It is experimental: sign-in steps,
							captchas, custom controls and sensitive questions stay with you.
						</Trans>
					</p>
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
