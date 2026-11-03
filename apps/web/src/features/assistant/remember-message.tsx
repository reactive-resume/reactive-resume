import type { FactCategory } from "@reactive-resume/schema/career";
import type { UIMessage } from "ai";
import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useQueryClient } from "@tanstack/react-query";
import { useId, useRef, useState } from "react";
import { Button } from "@reactive-resume/ui/components/button";
import { Checkbox } from "@reactive-resume/ui/components/checkbox";
import { Icon } from "@reactive-resume/ui/components/icon";
import { NativeSelect } from "@reactive-resume/ui/components/native-select";
import { Textarea } from "@reactive-resume/ui/components/textarea";
import { CATEGORIES, categoryLabel } from "@/features/career/knowledge/fact-categories";
import { getAccountGeneration, getAccountId } from "@/libs/auth/account-scope";
import { toastError } from "@/libs/error-message";
import { client, orpc } from "@/libs/orpc/client";

type RememberMessageProps = {
	message: UIMessage;
	applicationId: string | null;
	company: string | undefined;
	answer?: string;
};

export function RememberMessage({ message, applicationId, company, answer }: RememberMessageProps) {
	const queryClient = useQueryClient();
	const id = useId();
	const owner = useRef({ accountId: getAccountId(), generation: getAccountGeneration() });
	const saving = useRef(false);
	const current = () =>
		owner.current.accountId === getAccountId() && owner.current.generation === getAccountGeneration();
	const [open, setOpen] = useState(false);
	const [state, setState] = useState<"idle" | "saving" | "saved" | "forgotten">("idle");
	// The quote is the message's own words as the server saved them: its first text, verbatim.
	const quote = (answer ?? message.parts.find((part) => part.type === "text")?.text ?? "").trim().slice(0, 4000);
	const [text, setText] = useState(() => quote.slice(0, 2000));
	const [category, setCategory] = useState<FactCategory>("accomplishment");
	const [onlyHere, setOnlyHere] = useState(true);
	if (!quote) return null;

	const save = async () => {
		const accountId = owner.current.accountId;
		if (!accountId || !current() || saving.current) return;
		saving.current = true;
		setState("saving");
		try {
			const fact = await client.career.saveFact(
				{
					applicationId: applicationId && onlyHere ? applicationId : null,
					text: text.trim(),
					category,
					source: { kind: answer === undefined ? "user-message" : "manual", id: message.id, quote },
				},
				{ context: { accountId } },
			);
			if (!current()) return;
			setState(fact ? "saved" : "forgotten");
			setOpen(false);
			void queryClient.invalidateQueries({ queryKey: orpc.career.facts.key() });
		} catch (error) {
			if (!current()) return;
			setState("idle");
			toastError(error, t`Couldn't remember that. Try again.`, { allowServerMessage: true });
		} finally {
			saving.current = false;
		}
	};

	if (state === "saved" || state === "forgotten")
		return (
			<p className="flex items-center gap-1.5 text-xs text-ink-3">
				<Icon name={state === "saved" ? "check-circle" : "info"} size={15} />
				{state === "saved" ? (
					<Trans>Added to Knowledge.</Trans>
				) : (
					<Trans>Not saved — this fact was forgotten before.</Trans>
				)}
			</p>
		);
	if (!open)
		return (
			<button
				type="button"
				onClick={() => setOpen(true)}
				className="flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-xs text-ink-3 opacity-0 transition-opacity duration-quick group-hover/message:opacity-100 hover:text-ink focus-visible:opacity-100 pointer-coarse:opacity-100"
			>
				<Icon name="bookmark-simple" size={14} />
				<Trans>Remember</Trans>
			</button>
		);
	return (
		<form
			className="grid w-full max-w-[80%] gap-2 rounded-lg border border-line bg-raised p-3 text-start"
			onSubmit={(event) => {
				event.preventDefault();
				if (text.trim() && state !== "saving") void save();
			}}
		>
			<div className="grid gap-1">
				<label htmlFor={id} className="text-xs font-medium text-ink-2">
					<Trans>Remember as a fact in Knowledge</Trans>
				</label>
				<Textarea
					dir="auto"
					id={id}
					value={text}
					maxLength={2000}
					onChange={(event) => setText(event.target.value)}
					className="min-h-[64px] px-3 py-2 text-sm text-ink pointer-coarse:text-base"
				/>
			</div>
			<div className="flex flex-wrap items-center gap-2">
				<NativeSelect
					aria-label={t`Fact type`}
					value={category}
					onChange={(event) => setCategory(event.target.value as FactCategory)}
					className="h-8 w-auto text-[13px]"
				>
					{CATEGORIES.map((option) => (
						<option key={option} value={option}>
							{categoryLabel(option)}
						</option>
					))}
				</NativeSelect>
				{applicationId && company && (
					<label className="flex items-center gap-1.5 text-xs text-ink-2">
						<Checkbox checked={onlyHere} onCheckedChange={(checked) => setOnlyHere(checked === true)} />
						<Trans>Only for {company}</Trans>
					</label>
				)}
			</div>
			<p className="text-xs text-ink-3">
				<Trans>Saved from your message as you wrote it. Nothing is sent to the AI.</Trans>
			</p>
			<div className="flex gap-1.5">
				<Button type="submit" size="sm" loading={state === "saving"} disabled={!text.trim()}>
					<Trans>Remember</Trans>
				</Button>
				<Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
					<Trans>Cancel</Trans>
				</Button>
			</div>
		</form>
	);
}
