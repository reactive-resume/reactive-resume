import { useLingui } from "@lingui/react/macro";
import { useMutation } from "@tanstack/react-query";
import { client } from "@/api/client";
import { resume } from "@/draft/runtime";
import { showToast } from "@/ui";

/** Unlocks a resume and reloads the draft, with a toast when it can't. Write and the assistant share it. */
export function useUnlockResume(resumeId: string) {
	const { t } = useLingui();
	return useMutation({
		mutationKey: ["write", "unlock", resumeId],
		mutationFn: () => client.resume.setLocked({ id: resumeId, isLocked: false }),
		onSuccess: () => resume.refresh(),
		onError: () => showToast({ message: t`Couldn't unlock this resume. Try again.` }),
	});
}
