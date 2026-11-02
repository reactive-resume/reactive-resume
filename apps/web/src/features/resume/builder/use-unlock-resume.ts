import { useMutation } from "@tanstack/react-query";
import { toast } from "@reactive-resume/ui/components/toast";
import { useCurrentResume, usePatchResume } from "./draft";
import { getResumeErrorMessage } from "@/libs/error-message";
import { orpc } from "@/libs/orpc/client";

/** Unlocks the open resume, with the reason in a toast when it can't. Write and the assistant share it. */
export function useUnlockResume() {
	const resume = useCurrentResume();
	const patchResume = usePatchResume();
	const { mutate: setLocked, isPending } = useMutation(orpc.resume.setLocked.mutationOptions());

	const unlock = () =>
		setLocked(
			{ id: resume.id, isLocked: false },
			{
				onSuccess: () =>
					patchResume((draft) => {
						draft.isLocked = false;
					}),
				onError: (error) => toast.add({ type: "error", description: getResumeErrorMessage(error) }),
			},
		);
	return { unlock, isPending };
}
