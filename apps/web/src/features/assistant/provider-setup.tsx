import { Trans } from "@lingui/react/macro";
import { useState } from "react";
import { Button } from "@reactive-resume/ui/components/button";
import { SetUpAiDialog } from "@/features/ai/set-up-ai";

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
