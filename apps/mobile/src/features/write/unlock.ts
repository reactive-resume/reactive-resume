import { useLingui } from "@lingui/react/macro";
import { useMutation } from "@tanstack/react-query";
import { setResumeLocked } from "@/features/share/revision";
import { showToast } from "@/ui";

/** Unlocks a resume through the draft's revision protocol, with a toast when it can't. Write and the assistant share it. */
export function useUnlockResume(resumeId: string) {
	const { t } = useLingui();
	return useMutation({
		mutationKey: ["write", "unlock", resumeId],
		mutationFn: () => setResumeLocked(resumeId, false),
		onError: () => showToast({ message: t`Couldn't unlock this resume. Try again.` }),
	});
}
