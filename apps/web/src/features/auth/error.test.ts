import { beforeAll, expect, it } from "vite-plus/test";
import { i18n } from "@lingui/core";
import { authErrorMessage } from "./error";

beforeAll(() => {
	i18n.load("en-US", {});
	i18n.activate("en-US");
});

it.each([
	"INVALID_EMAIL_OR_PASSWORD",
	"INVALID_USERNAME_OR_PASSWORD",
	"INVALID_TWO_FACTOR_COOKIE",
	"INVALID_TOKEN",
	"INVALID_OTP",
	"INVALID_BACKUP_CODE",
])("maps %s to product recovery copy without exposing server text", (code) => {
	const message = authErrorMessage({ code, message: "private backend diagnostic" }, "Fallback");
	expect(message).not.toBe("Fallback");
	expect(message).not.toContain("private backend diagnostic");
});

it("keeps recognized guest conflict recovery guidance but rejects arbitrary server messages", () => {
	const message =
		"Guest and account Career preferences differ. Your guest work is unchanged. Match Career preferences and Knowledge memory settings in both accounts before trying again.";
	expect(authErrorMessage({ message }, "Fallback")).toBe(message);
	expect(authErrorMessage({ code: "UNKNOWN", message: "private backend diagnostic" }, "Fallback")).toBe("Fallback");
});
