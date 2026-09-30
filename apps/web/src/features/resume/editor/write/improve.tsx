import type { IconName } from "@reactive-resume/ui/components/icon";
import type { Editor } from "@tiptap/react";
import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { Button } from "@reactive-resume/ui/components/button";
import { Icon } from "@reactive-resume/ui/components/icon";
import { Input } from "@reactive-resume/ui/components/input";
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
};

/**
 * B · Improve: pick what to change, then Replace or Keep mine. Only the one line changes, and only when the user
 * replaces it; if the line was edited meanwhile, the suggestion is not applied.
 */
export function ImprovePanel({ editor, line, where, onClose }: ImprovePanelProps) {
	const [asking, setAsking] = useState(false);
	const [request, setRequest] = useState("");
	const [changed, setChanged] = useState(false);
	const improve = useMutation(orpc.ai.improve.mutationOptions());

	const options: Array<{ action: Action; icon: IconName; label: string }> = [
		{ action: "verb", icon: "bolt", label: t`Stronger verb` },
		{ action: "result", icon: "trending_up", label: t`Add a result` },
		{ action: "shorter", icon: "compress", label: t`Make it shorter` },
	];

	const run = (action: Action) =>
		improve.mutate({
			action,
			line: line.text,
			where,
			context: editor.getText(),
			...(action === "custom" ? { request: request.trim() } : {}),
		});

	const close = () => {
		onClose();
		editor.commands.focus();
	};

	const replace = (text: string) => {
		const current = editor.state.doc.textBetween(line.from, line.to);
		if (current !== line.text) return setChanged(true);
		editor.chain().focus().insertContentAt({ from: line.from, to: line.to }, text).run();
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
			<span className="px-2 pt-1 pb-1.5 text-xs font-semibold text-ink-3 uppercase">
				<Trans>Improve selected line</Trans>
			</span>

			{improve.data ? (
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
					</div>
				</div>
			) : improve.isPending ? (
				<p role="status" className="flex items-center gap-2 p-2 text-sm text-ink-2">
					<Icon name="auto_awesome" size={16} className="animate-pulse motion-reduce:animate-none" />
					<Trans>Improving…</Trans>
				</p>
			) : asking ? (
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
							onClick={() => run(option.action)}
							className="flex h-9 items-center gap-2.5 rounded-md px-2 text-start text-sm transition-colors duration-quick hover:bg-hover"
						>
							<Icon name={option.icon} size={18} className="text-ink-2" />
							{option.label}
						</button>
					))}
					<button
						type="button"
						onClick={() => setAsking(true)}
						className="flex h-9 items-center gap-2.5 rounded-md px-2 text-start text-sm transition-colors duration-quick hover:bg-hover"
					>
						<Icon name="chat" size={18} className="text-ink-2" />
						<Trans>Ask for something else…</Trans>
					</button>
				</div>
			)}

			{improve.error && (
				<div className="grid gap-2 px-2 pb-1">
					<p role="alert" className="text-xs text-danger-text">
						{getOrpcErrorMessage(improve.error, { fallback: t`Couldn't get a suggestion. Nothing changed.` })}
					</p>
					<Button size="sm" variant="secondary" className="w-fit" onClick={() => improve.reset()}>
						<Trans>Try again</Trans>
					</Button>
				</div>
			)}
		</div>
	);
}
