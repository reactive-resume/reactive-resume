import { Trans } from "@lingui/react/macro";
import { useState } from "react";
import { Button } from "@reactive-resume/ui/components/button";
import { ConnectionForm, SetUpAiDialog } from "@/features/ai/set-up-ai";

type ProviderSetupProps = {
	/** Kept for callers that connect another one while some are saved; the form is the same. */
	connectOnly?: boolean;
};

/**
 * The Set up AI form for callers that already draw their own dialog around it. New callers use `SetUpAi` or
 * `useSetUpAi` from `@/features/ai/set-up-ai`, which open the one dialog (N11).
 */
export function ProviderSetup(_props: ProviderSetupProps) {
	return (
		<div className="grid gap-4 p-4">
			<ConnectionForm onTesting={() => {}} onConnected={() => {}} />
		</div>
	);
}

/** A "Set up AI" button that opens the dialog in place, keeping the task's typed input and files. */
export function SetUpAi() {
	const [open, setOpen] = useState(false);
	return (
		<>
			<Button type="button" size="sm" variant="secondary" className="w-fit" onClick={() => setOpen(true)}>
				<Trans>Set up AI</Trans>
			</Button>
			<SetUpAiDialog open={open} onOpenChange={setOpen} />
		</>
	);
}
