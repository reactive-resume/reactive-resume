import { t } from "@lingui/core/macro";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { orpc } from "@/integrations/orpc/client";
import { downloadFromUrl, reviewerPdfName } from "@/utils/file";

/** A reviewer saving a student's resume as a PDF, from wherever they are looking at it. */
export function useResumeDownload() {
	const { mutateAsync: printResumeAsPDF, isPending } = useMutation(orpc.printer.printResumeAsPDF.mutationOptions());

	const download = async (resumeId: string, rollNumber: string | null | undefined, name: string | null | undefined) => {
		const toastId = toast.loading(t`Preparing the PDF…`);
		try {
			const { url } = await printResumeAsPDF({ id: resumeId });
			await downloadFromUrl(url, reviewerPdfName(rollNumber, name));
			toast.success(t`Download ready.`, { id: toastId });
		} catch (error) {
			toast.error(error instanceof Error ? error.message : t`Could not generate the PDF.`, { id: toastId });
		}
	};

	return { download, isPending };
}
