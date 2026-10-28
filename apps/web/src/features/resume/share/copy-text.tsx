import { t } from "@lingui/core/macro";
import { useEffect, useRef, useState } from "react";
import { useCopyToClipboard } from "usehooks-ts";
import { toast } from "@reactive-resume/ui/components/toast";
import { Tooltip, TooltipContent, TooltipTrigger } from "@reactive-resume/ui/components/tooltip";
import { cn } from "@reactive-resume/utils/style";

const COPIED_MS = 1600;

type CopyTextProps = { value: string; className?: string };

/** Text that copies itself when clicked. The tooltip offers the copy, then confirms it, on touch screens too. */
export function CopyText({ value, className }: CopyTextProps) {
	const [hovered, setHovered] = useState(false);
	const [copied, setCopied] = useState(false);
	const [, copyToClipboard] = useCopyToClipboard();
	const timer = useRef<number>(undefined);

	useEffect(() => () => window.clearTimeout(timer.current), []);

	const copy = async () => {
		if (!(await copyToClipboard(value))) {
			toast.add({ type: "error", description: t`Couldn't copy to the clipboard. Try again.` });
			return;
		}
		setCopied(true);
		window.clearTimeout(timer.current);
		timer.current = window.setTimeout(() => setCopied(false), COPIED_MS);
	};

	return (
		<Tooltip open={hovered || copied} onOpenChange={setHovered}>
			<TooltipTrigger
				closeOnClick={false}
				render={
					<button
						type="button"
						aria-label={t`Copy ${value}`}
						onClick={() => void copy()}
						className={cn(
							"-mx-1 rounded-sm px-1 text-start break-all transition-colors duration-quick hover:bg-hover active:bg-press",
							className,
						)}
					/>
				}
			>
				{value}
			</TooltipTrigger>
			<TooltipContent>{copied ? t`Copied` : t`Copy`}</TooltipContent>
			<span className="sr-only" aria-live="polite">
				{copied ? t`Copied` : ""}
			</span>
		</Tooltip>
	);
}
