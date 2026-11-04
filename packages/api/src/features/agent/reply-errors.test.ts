import { expect, it } from "vite-plus/test";
import { APICallError } from "ai";
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
it("never shows a provider's error body, which can echo the request's API key", () => {
	const error = new APICallError({
		message: "Rate limited for key sk-private-key-material",
		url: "https://provider.example/v1/chat",
		requestBodyValues: {},
		statusCode: 429,
		responseBody: '{"error":"sk-private-key-material"}',
	});
	expect(replyErrorMessage(error)).toBe(AGENT_REPLY_ERRORS.providerLimit);
});
