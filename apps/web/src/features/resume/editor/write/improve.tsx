import type { IconName } from "@reactive-resume/ui/components/icon";
import type { Editor } from "@tiptap/react";
import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useMutation } from "@tanstack/react-query";
import { useEditorState } from "@tiptap/react";
import { useId, useRef, useState } from "react";
import { Badge } from "@reactive-resume/ui/components/badge";
import { Button } from "@reactive-resume/ui/components/button";
import { Icon } from "@reactive-resume/ui/components/icon";
import { Input } from "@reactive-resume/ui/components/input";
import { SetUpAi } from "@/features/ai/set-up-ai";
import { AiResultUsage } from "@/features/ai/usage";
import { useHasUsableAiProvider } from "@/features/settings/integrations/hooks/use-has-usable-ai-provider";
import { getOrpcErrorMessage } from "@/libs/error-message";
import { orpc } from "@/libs/orpc/client";

type Action = "verb" | "result" | "shorter" | "posting" | "warmer" | "custom";

/** In a cover letter the unit is a paragraph, with presets of its own; `applicationId` is the linked job. */
export type ImproveKind = { letter: true; applicationId?: string | null | undefined };

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
	onAccept: (text: string, aiOperationIds?: string[]) => void;
	kind?: ImproveKind | undefined;
};

/**
 * B · Improve: pick what to change, then Replace or Keep mine. Only the one line changes, and only when the user
 * replaces it; if the line was edited meanwhile, the suggestion is not applied.
 */
export function ImprovePanel({ editor, line, where, onClose, onAccept, kind }: ImprovePanelProps) {
	const providers = useHasUsableAiProvider();
	const provider = providers.usableProviders[0];
	// "custom" asks what to change; "result" asks what the result was, since only the user knows it.
	const [asking, setAsking] = useState<"custom" | "result" | null>(null);
	const [request, setRequest] = useState("");
	const [result, setResult] = useState("");
	// The last request sent, with its words, so Try again and Try another send exactly that again.
	const [last, setLast] = useState<{ action: Action; words: string } | null>(null);
	const changed = useEditorState({
		editor,
		selector: ({ editor }) =>
			line.to > editor.state.doc.content.size || editor.state.doc.textBetween(line.from, line.to) !== line.text,
	});
	const replaced = useRef(false);
	const improve = useMutation(orpc.ai.improve.mutationOptions());
	const resultId = useId();

	const letter = kind?.letter === true;
	const applicationId = kind?.applicationId ?? undefined;
	const options: Array<{ action: Action; icon: IconName; label: string }> = letter
		? [
				...(applicationId
					? [{ action: "posting" as const, icon: "briefcase" as const, label: t`Tie to the posting` }]
					: []),
				{ action: "warmer", icon: "hand-heart", label: t`Warmer` },
				{ action: "shorter", icon: "arrows-in-line-vertical", label: t`Shorter` },
			]
		: [
				{ action: "verb", icon: "lightning", label: t`Stronger verb` },
				{ action: "result", icon: "trend-up", label: t`Add a result` },
				{ action: "shorter", icon: "arrows-in-line-vertical", label: t`Make it shorter` },
			];

	const run = (
		action: Action,
		words = action === "custom" ? request.trim() : action === "result" ? result.trim() : "",
	) => {
		if (!provider) return;
		setLast({ action, words });
		improve.mutate({
			aiProviderId: provider.id,
			includeProvenance: true,
			action,
			line: line.text,
			where,
			context: editor.getText(),
			...(words ? { request: words } : {}),
			...(action === "posting" && applicationId ? { applicationId } : {}),
		});
	};
	const pick = (action: Action) => (action === "result" ? setAsking("result") : run(action));

	const close = () => {
		onClose();
		editor.commands.focus();
	};

	const replace = (text: string) => {
		if (replaced.current) return;
		if (changed) return;
		replaced.current = true;
		onAccept(text, improve.data?.aiOperationIds);
		onClose();
	};

	return (
		// oxlint-disable-next-line jsx-a11y/no-static-element-interactions -- Escape closes the panel from any control inside it.
		<div
			role="region"
			aria-label={t`Suggestion`}
			className="grid gap-2"
			onKeyDown={(event) => {
				if (event.key !== "Escape") return;
				event.stopPropagation();
				close();
			}}
		>
			{changed && improve.data ? (
				<>
					<p role="status" className="t-small text-warn-text">
						<Trans>The line changed since you asked, so it wasn't replaced.</Trans>
					</p>
					<Button size="sm" variant="secondary" className="w-fit" onClick={close}>
						<Trans>Keep mine</Trans>
					</Button>
				</>
			) : (
				<>
					<div className="flex items-center justify-between gap-2">
						<span className={!provider || improve.data ? "t-caption font-medium text-ink-3" : "t-label text-ink"}>
							{letter ? <Trans>Improve this paragraph</Trans> : <Trans>Improve selected line</Trans>}
						</span>
						{provider && (
							<span className="text-xs text-ink-3">
								{provider.label} · {provider.model}
							</span>
						)}
						<Button size="icon-xs" variant="ghost" aria-label={t`Close`} onClick={close}>
							<Icon name="x" size={16} />
						</Button>
					</div>
					{!provider && (
						<SetUpAi
							needs={<Trans>Improve needs AI.</Trans>}
							works={<Trans>Editing and formatting work without it.</Trans>}
						/>
					)}
					<div className="rounded-lg bg-sunken px-3 py-2.5">
						<span className="block t-caption text-ink-3">
							<Trans>Yours</Trans>
						</span>
						<blockquote className="t-small whitespace-pre-wrap text-ink-2">{line.text}</blockquote>
					</div>
					{!provider && (
						<ul className="grid gap-1 t-small text-ink-2">
							<li className="flex items-start gap-1.5">
								<Icon name="lightning" size={14} className="mt-px shrink-0" />
								<Trans>Does it start with what you did?</Trans>
							</li>
							<li className="flex items-start gap-1.5">
								<Icon name="trend-up" size={14} className="mt-px shrink-0" />
								<Trans>What changed: a number, a time saved, who used it?</Trans>
							</li>
							<li className="flex items-start gap-1.5">
								<Icon name="arrows-in-line-vertical" size={14} className="mt-px shrink-0" />
								<Trans>Could it be shorter?</Trans>
							</li>
						</ul>
					)}
					{!provider ? null : improve.data ? (
						<div className="grid gap-2">
							<p
								role="status"
								className="flex items-start gap-2.5 rounded-lg bg-accent-soft px-3 py-2.5 text-[13px]/[18px]"
							>
								<Icon name="sparkle" size={18} className="shrink-0 text-accent-text" />
								<span>{improve.data.text}</span>
							</p>

							{improve.data.addsFacts && (
								<Badge variant="warn" className="w-fit">
									<Icon name="warning-circle" size={14} />
									<Trans>New detail: check it's true</Trans>
								</Badge>
							)}
							<div className="flex gap-1.5">
								{!changed && (
									<Button size="sm" variant="soft" onClick={() => replace(improve.data.text)}>
										<Trans>Replace</Trans>
									</Button>
								)}
								<Button size="sm" variant="ghost" onClick={close}>
									<Trans>Keep mine</Trans>
								</Button>
								{last && !changed && (
									<Button size="sm" variant="ghost" onClick={() => run(last.action, last.words)}>
										<Trans>Try another</Trans>
									</Button>
								)}
							</div>
							<p className="text-xs text-ink-3">{improve.data.why}</p>
							<details className="t-caption text-ink-3">
								<summary className="cursor-pointer">
									<Trans>AI request details</Trans>
								</summary>
								<AiResultUsage usage={improve.data.aiUsage} />
							</details>
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
								<Button type="submit" size="sm" variant="secondary" disabled={!result.trim()}>
									<Trans>Add</Trans>
								</Button>
							</div>
							<button
								type="button"
								className="w-fit text-xs text-ink-3 underline underline-offset-2"
								onClick={() => run("result", "")}
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
							<Button type="submit" size="sm" variant="secondary" disabled={!request.trim()}>
								<Trans>Ask</Trans>
							</Button>
						</form>
					) : (
						<div className="flex flex-wrap gap-1.5">
							{options.map((option, index) => (
								<button
									key={option.action}
									type="button"
									// oxlint-disable-next-line jsx-a11y/no-autofocus -- the menu opens from the Improve button.
									autoFocus={index === 0}
									onClick={() => pick(option.action)}
									className="flex h-7 items-center gap-1.5 rounded-sm border border-line-2 px-2 text-start t-small transition-colors duration-quick hover:bg-hover"
								>
									<Icon name={option.icon} size={18} className="text-ink-2" />
									{option.label}
								</button>
							))}
							<button
								type="button"
								onClick={() => setAsking("custom")}
								className="flex h-7 items-center gap-1.5 rounded-sm border border-line-2 px-2 text-start t-small transition-colors duration-quick hover:bg-hover"
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
							<Button
								size="sm"
								variant="secondary"
								className="w-fit"
								onClick={() => (last ? run(last.action, last.words) : improve.reset())}
							>
								<Trans>Try again</Trans>
							</Button>
						</div>
					)}
				</>
			)}
		</div>
	);
}
