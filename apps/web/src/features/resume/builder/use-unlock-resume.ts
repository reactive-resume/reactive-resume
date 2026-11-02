import { useMutation } from "@tanstack/react-query";
import { toast } from "@reactive-resume/ui/components/toast";
import { useCurrentResume, usePatchResume } from "./draft";
import { setResumeLocked } from "./lock";
import { getResumeErrorMessage } from "@/libs/error-message";

/** Unlocks the open resume, with the reason in a toast when it can't. Write and the assistant share it. */
export function useUnlockResume() {
	const resume = useCurrentResume();
	const patchResume = usePatchResume();
	const { mutate: setLocked, isPending } = useMutation({
		// The next autosave builds on the unlocked revision instead of conflicting with it.
		mutationFn: (id: string) => setResumeLocked(id, false),
	});

	const unlock = () =>
		setLocked(resume.id, {
			onSuccess: () =>
				patchResume((draft) => {
					draft.isLocked = false;
				}),
			onError: (error) => toast.add({ type: "error", description: getResumeErrorMessage(error) }),
		});
	return { unlock, isPending };
}
