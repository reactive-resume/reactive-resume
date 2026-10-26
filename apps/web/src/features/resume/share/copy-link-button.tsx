import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useRef, useState } from "react";
import { useCopyToClipboard } from "usehooks-ts";
import { Button } from "@reactive-resume/ui/components/button";
import { Icon } from "@reactive-resume/ui/components/icon";
import { Swap } from "@reactive-resume/ui/components/swap";
import { toast } from "@reactive-resume/ui/components/toast";

const COPIED_MS = 2000;

type CopyLinkButtonProps = {
	url: string;
	disabled?: boolean;
	className?: string;
};

/** Copies `url` and shows "Copied" for two seconds. */
export function CopyLinkButton({ url, disabled, className }: CopyLinkButtonProps) {
	const [copied, setCopied] = useState(false);
	const [, copyToClipboard] = useCopyToClipboard();
	const timer = useRef<number>(undefined);

	const copy = async () => {
		if (!(await copyToClipboard(url))) {
			toast.add({ type: "error", description: t`Couldn't copy to the clipboard. Try again.` });
			return;
		}
		setCopied(true);
		window.clearTimeout(timer.current);
		timer.current = window.setTimeout(() => setCopied(false), COPIED_MS);
		toast.add({ description: t`Link copied` });
	};

	return (
		<Button
			variant="secondary"
			className={className}
			disabled={disabled}
			aria-live="polite"
			onClick={() => void copy()}
		>
			<Swap
				swapped={copied}
				from={
					<>
						<Icon name="copy" size={18} />
						<Trans>Copy</Trans>
					</>
				}
				to={
					<>
						<Icon name="check" size={18} />
						<Trans>Copied</Trans>
					</>
				}
			/>
		</Button>
	);
}
