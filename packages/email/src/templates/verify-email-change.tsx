import type { Locale } from "@reactive-resume/utils/locale";
import { verifyEmailChange } from "./auth";

type PreviewProps = { url: string; previousEmail: string; newEmail: string; locale: Locale };
const VerifyEmailChangePreview = (props: PreviewProps) => verifyEmailChange(props).react;

export default Object.assign(VerifyEmailChangePreview, {
	PreviewProps: {
		url: "https://localhost:3000/auth/verify-email-change?token=example-token",
		previousEmail: "old@example.com",
		newEmail: "new@example.com",
		locale: "en-US",
	} satisfies PreviewProps,
});
