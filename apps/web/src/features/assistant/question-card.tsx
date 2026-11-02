import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useId, useRef, useState } from "react";
import { Button } from "@reactive-resume/ui/components/button";

type QuestionPart = {
	toolCallId?: string;
	state?: string;
	input?: unknown;
	output?: unknown;
	errorText?: string;
};

type QuestionCardProps = {
	part: QuestionPart;
	readOnly: boolean;
	/** A reply is in flight: keep the choices visible but stop a second answer. */
	busy?: boolean;
	/** The conversation moved on without an answer: the question is retired, not waiting. */
	passed?: boolean;
	onAnswer: (toolCallId: string, answer: string) => void;
};

/** The assistant asks before writing anything the document doesn't say: an info-soft card with its choices. */
export function QuestionCard({ part, readOnly, busy = false, passed = false, onAnswer }: QuestionCardProps) {
	const id = useId();
	const [other, setOther] = useState("");
	const submitted = useRef(false);
	const input = (part.input ?? {}) as { question?: unknown; choices?: unknown };
	const question = typeof input.question === "string" ? input.question : "";
	const choices = Array.isArray(input.choices)
		? input.choices.filter((choice): choice is string => typeof choice === "string")
		: [];
	const answer = part.state === "output-available" && typeof part.output === "string" ? part.output : null;
	const toolCallId = part.toolCallId;
	const canAnswer = part.state === "input-available" && !readOnly && toolCallId !== undefined;
	if (!question && part.state === "input-streaming" && busy) return null;
	if (!question && part.state !== "input-streaming" && part.state !== "output-error") return null;

	const submit = (value: string) => {
		const trimmed = value.trim();
		if (!trimmed || busy || !canAnswer || !toolCallId || submitted.current) return;
		// Two activations in one render turn must not let the second answer replace the first.
		submitted.current = true;
		onAnswer(toolCallId, trimmed);
	};

	return (
		<div className="grid gap-2.5 rounded-xl bg-info-soft p-3 text-info-text">
			{question && <p className="text-sm font-medium">{question}</p>}
			{answer !== null ? (
				<p className="text-[13px] opacity-80">
					<Trans>You answered: {answer}</Trans>
				</p>
			) : part.state === "input-streaming" ? (
				busy ? null : (
					<p role="status" className="text-[13px] opacity-80">
						<Trans>This question didn't finish.</Trans>
					</p>
				)
			) : part.state === "output-error" ? (
				<p role="status" className="text-[13px] opacity-80">
					<Trans>This question couldn't be asked. Send a new message to continue.</Trans>
				</p>
			) : passed && part.state === "input-available" ? (
				<p className="text-[13px] opacity-80">
					<Trans>Not answered. The conversation went on below.</Trans>
				</p>
			) : canAnswer ? (
				<>
					{choices.length > 0 && (
						<div className="flex flex-wrap gap-1.5">
							{choices.map((choice) => (
								<Button key={choice} size="sm" variant="secondary" disabled={busy} onClick={() => submit(choice)}>
									{choice}
								</Button>
							))}
						</div>
					)}
					<form
						className="flex gap-1.5"
						onSubmit={(event) => {
							event.preventDefault();
							submit(other);
						}}
					>
						<label htmlFor={id} className="sr-only">
							<Trans>Answer in your own words</Trans>
						</label>
						<input
							id={id}
							value={other}
							disabled={busy}
							onChange={(event) => setOther(event.target.value)}
							placeholder={t`Or in your own words…`}
							className="h-8 min-w-0 flex-1 rounded-md border border-control-border bg-raised px-2 text-sm text-ink transition-[border-color,box-shadow] outline-none focus:border-accent pointer-coarse:h-11 pointer-coarse:text-base"
						/>
						<Button type="submit" size="sm" disabled={busy || !other.trim()}>
							<Trans>Send</Trans>
						</Button>
					</form>
				</>
			) : null}
		</div>
	);
}
