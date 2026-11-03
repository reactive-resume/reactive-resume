import { expect, it } from "vite-plus/test";
import { AGENT_REPLY_ERRORS } from "@reactive-resume/ai/tools/agent-tool-contracts";
import { WebAccessError } from "../web-access/contracts";
import { replyErrorMessage } from "./reply-errors";

it.each([
	["auth", "Web access failed (auth)."],
	["quota", "Web access failed (quota)."],
	["rate-limit", "Web access failed (rate-limit)."],
] as const)("preserves safe web failure %s across stream error redaction", (reason, wire) => {
	const error = new WebAccessError(reason);
	error.message = "private-key-material from an unsafe error message";
	expect(replyErrorMessage(error)).toBe(wire);
});
it("does not trust the name or text of an unknown provider error", () => {
	const error = new Error("Web access failed (auth). private-key-material");
	error.name = "WebAccessError";
	expect(replyErrorMessage(error)).toBe(AGENT_REPLY_ERRORS.failed);
});
