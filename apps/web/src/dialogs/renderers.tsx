import type { DialogSchema } from "./schemas";
import { ChangePasswordDialog } from "./auth/change-password";
import { DisableTwoFactorDialog } from "./auth/disable-two-factor";
import { EnableTwoFactorDialog } from "./auth/enable-two-factor";
import { ResumeDialog } from "./resume";
import { NewDocumentDialog } from "@/features/documents/new-document-dialog";

export const renderDialog = (dialog: DialogSchema) => {
	switch (dialog.type) {
		case "auth.change-password":
			return <ChangePasswordDialog />;
		case "auth.two-factor.enable":
			return <EnableTwoFactorDialog />;
		case "auth.two-factor.disable":
			return <DisableTwoFactorDialog />;
		case "document.new":
			return <NewDocumentDialog data={dialog.data} />;
		case "resume.update":
			return <ResumeDialog mode="update" data={dialog.data} />;
		case "resume.duplicate":
			return <ResumeDialog mode="duplicate" data={dialog.data} />;
	}
};
