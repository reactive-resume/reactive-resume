import type { Locale } from "@reactive-resume/utils/locale";
import { resetPasswordEmail } from "./auth";

const ResetPasswordPreview = (props: { url: string; locale: Locale }) => resetPasswordEmail(props).react;

export default Object.assign(ResetPasswordPreview, {
	PreviewProps: { url: "https://localhost:3000/auth/reset-password?token=example-token", locale: "en-US" },
} satisfies { PreviewProps: Parameters<typeof resetPasswordEmail>[0] });
