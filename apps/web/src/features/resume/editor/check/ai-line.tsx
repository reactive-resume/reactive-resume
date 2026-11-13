import type { ReactNode } from "react";
import { SetUpAiLine } from "@/components/calm/set-up-ai-line";
import { useSetUpAi } from "@/features/ai/set-up-ai";

type CheckAiLineProps = { lead: ReactNode; children: ReactNode };
export function CheckAiLine({ lead, children }: CheckAiLineProps) {
	const setUp = useSetUpAi();
	return (
		<>
			<SetUpAiLine lead={lead} onSetUp={setUp.open}>
				{children}
			</SetUpAiLine>
			{setUp.dialog}
		</>
	);
}
