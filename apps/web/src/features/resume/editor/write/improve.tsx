import type { IconName } from "@reactive-resume/ui/components/icon";
import type { Editor } from "@tiptap/react";
import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useMutation } from "@tanstack/react-query";
import { useId, useState } from "react";
import { Button } from "@reactive-resume/ui/components/button";
import { Icon } from "@reactive-resume/ui/components/icon";
import { Input } from "@reactive-resume/ui/components/input";
import { SetUpAi } from "@/features/assistant/provider-setup";
import { useHasUsableAiProvider } from "@/features/settings/integrations/hooks/use-has-usable-ai-provider";
import { getOrpcErrorMessage } from "@/libs/error-message";
import { orpc } from "@/libs/orpc/client";

type Action = "verb" | "result" | "shorter" | "custom";

/** The line Improve works on: the paragraph or list item holding the caret, as it was when Improve opened. */
export type ImproveLine = { from: number; to: number; text: string };

export function lineAtCaret(editor: Editor): ImproveLine | null {
	const { $from } = editor.state.selection;
	if (!$from.parent.isTextblock) return null;
	const text = $from.parent.textContent;
	if (!text.trim()) return null;
	return { from: $from.start(), to: $from.end(), text };
}

type ImprovePanelProps = {
	editor: Editor;
	line: ImproveLine;
	/** Where the line sits, e.g. the field's label. */
	where: string;
	onClose: () => void;
	/** Applies the accepted text as its own editor/app history event. */
	onAccept: (text: string) => void;
};

/**
 * B · Improve: pick what to change, then Replace or Keep mine. Only the one line changes, and only when the user
 * replaces it; if the line was edited meanwhile, the suggestion is not applied.
 */
export function ImprovePanel({ editor, line, where, onClose, onAccept }: ImprovePanelProps) {
	const providers = useHasUsableAiProvider();
	const provider = providers.usableProviders[0];
	// "custom" asks what to change; "result" asks what the result was, since only the user knows it.
	const [asking, setAsking] = useState<"custom" | "result" | null>(null);
	const [request, setRequest] = useState("");
	const [result, setResult] = useState("");
	// The last request sent, so Try again and Try another send it again.
	const [last, setLast] = useState<Action | null>(null);
	const [changed, setChanged] = useState(false);
	const improve = useMutation(orpc.ai.improve.mutationOptions());
	const resultId = useId();

	const options: Array<{ action: Action; icon: IconName; label: string }> = [
		{ action: "verb", icon: "lightning", label: t`Stronger verb` },
		{ action: "result", icon: "trend-up", label: t`Add a result` },
		{ action: "shorter", icon: "arrows-in-line-vertical", label: t`Make it shorter` },
	];

	const run = (action: Action) => {
		if (!provider) return;
		setLast(action);
		const words = action === "custom" ? request.trim() : action === "result" ? result.trim() : "";
		improve.mutate({
			aiProviderId: provider.id,
			action,
			line: line.text,
			where,
			context: editor.getText(),
			...(words ? { request: words } : {}),
		});
	};
	const pick = (action: Action) => (action === "result" ? setAsking("result") : run(action));

	const close = () => {
		onClose();
		editor.commands.focus();
	};

	const replace = (text: string) => {
		const current = editor.state.doc.textBetween(line.from, line.to);
		if (current !== line.text) return setChanged(true);
		onAccept(text);
		onClose();
	};

	return (
		// oxlint-disable-next-line jsx-a11y/no-static-element-interactions -- Escape closes the panel from any control inside it.
		<div
			className="grid gap-1 border-t border-line p-1.5"
			onKeyDown={(event) => {
				if (event.key !== "Escape") return;
				event.stopPropagation();
				close();
			}}
		>
			<span className="px-2 pt-1 pb-1.5 text-xs font-semibold text-ink-3">
				<Trans>Improve selected line</Trans>
			</span>

			<p className="px-2 text-xs text-ink-3">
				<Trans>Original</Trans>
			</p>
			<blockquote className="rounded bg-sunken p-2 text-sm whitespace-pre-wrap">{line.text}</blockquote>
			{!provider ? (
				<SetUpAi />
			) : (
				<p className="px-2 text-xs text-ink-3">
					<Trans>
						Sends this line, surrounding field text and your instructions to {provider.label} · {provider.model}.
					</Trans>
				</p>
			)}
			{!provider ? null : improve.data ? (
				<div className="grid gap-2 rounded-lg bg-bg p-2.5">
					<p role="status" className="w-fit rounded-sm bg-accent-soft px-1 py-0.5 text-[13px] leading-[19px]">
						{improve.data.text}
					</p>
					<p className="text-xs text-ink-3">
						{improve.data.why}
						{improve.data.addsFacts && <> {t`Check it's accurate.`}</>}
					</p>
					{changed && (
						<p role="alert" className="text-xs text-danger-text">
							<Trans>The line changed since you asked, so it wasn't replaced.</Trans>
						</p>
					)}
					<div className="flex gap-1.5">
						{!changed && (
							<Button size="sm" onClick={() => replace(improve.data.text)}>
								<Trans>Replace</Trans>
							</Button>
						)}
						<Button size="sm" variant="secondary" onClick={close}>
							<Trans>Keep mine</Trans>
						</Button>
						{last && !changed && (
							<Button size="sm" variant="ghost" onClick={() => run(last)}>
								<Trans>Try another</Trans>
							</Button>
						)}
					</div>
				</div>
			) : improve.isPending ? (
				<p role="status" className="flex items-center gap-2 p-2 text-sm text-ink-2">
					<Icon name="sparkle" size={16} className="animate-pulse motion-reduce:animate-none" />
					<Trans>Improving…</Trans>
				</p>
			) : asking === "result" ? (
				<form
					className="grid gap-1.5 p-1"
					onSubmit={(event) => {
						event.preventDefault();
						run("result");
					}}
				>
					<label htmlFor={resultId} className="text-xs text-ink-2">
						<Trans>What changed because of this? A number, a time saved, who used it.</Trans>
					</label>
					<div className="flex gap-1.5">
						<Input
							id={resultId}
							autoFocus
							value={result}
							maxLength={500}
							onChange={(event) => setResult(event.target.value)}
						/>
						<Button type="submit" size="sm" disabled={!result.trim()}>
							<Trans>Add</Trans>
						</Button>
					</div>
					<button
						type="button"
						className="w-fit text-xs text-ink-3 underline underline-offset-2"
						onClick={() => run("result")}
					>
						<Trans>I don't have one yet</Trans>
					</button>
				</form>
			) : asking === "custom" ? (
				<form
					className="flex gap-1.5 p-1"
					onSubmit={(event) => {
						event.preventDefault();
						if (request.trim()) run("custom");
					}}
				>
					<Input
						autoFocus
						aria-label={t`What should change?`}
						placeholder={t`What should change?`}
						value={request}
						maxLength={500}
						onChange={(event) => setRequest(event.target.value)}
					/>
					<Button type="submit" size="sm" disabled={!request.trim()}>
						<Trans>Ask</Trans>
					</Button>
				</form>
			) : (
				<div className="grid gap-0.5">
					{options.map((option, index) => (
						<button
							key={option.action}
							type="button"
							// oxlint-disable-next-line jsx-a11y/no-autofocus -- the menu opens from the Improve button.
							autoFocus={index === 0}
							onClick={() => pick(option.action)}
							className="flex h-9 items-center gap-2.5 rounded-md px-2 text-start text-sm transition-colors duration-quick hover:bg-hover"
						>
							<Icon name={option.icon} size={18} className="text-ink-2" />
							{option.label}
						</button>
					))}
					<button
						type="button"
						onClick={() => setAsking("custom")}
						className="flex h-9 items-center gap-2.5 rounded-md px-2 text-start text-sm transition-colors duration-quick hover:bg-hover"
					>
						<Icon name="chat-text" size={18} className="text-ink-2" />
						<Trans>Ask for something else…</Trans>
					</button>
				</div>
			)}

			{improve.error && (
				<div className="grid gap-2 px-2 pb-1">
					<p role="alert" className="text-xs text-danger-text">
						{getOrpcErrorMessage(improve.error, { fallback: t`Couldn't get a suggestion. Nothing changed.` })}
					</p>
					{/* Sends the same request again; the options stay one step back. */}
					<Button size="sm" variant="secondary" className="w-fit" onClick={() => (last ? run(last) : improve.reset())}>
						<Trans>Try again</Trans>
					</Button>
				</div>
			)}
		</div>
	);
}
