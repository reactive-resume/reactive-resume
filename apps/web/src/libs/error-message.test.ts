import { beforeEach, describe, expect, it } from "vite-plus/test";
import { i18n } from "@lingui/core";
import { ORPCError } from "@orpc/client";
import { AGENT_REPLY_ERRORS } from "@reactive-resume/ai/tools/agent-tool-contracts";
import { SUBMITTED_DOCUMENT_LOCKED } from "@reactive-resume/schema/applications/errors";
import {
	getOrpcErrorMessage,
	getReadableErrorMessage,
	getResumeErrorMessage,
	isProviderFailure,
} from "./error-message";

beforeEach(() => {
	i18n.load("en", {});
	i18n.activate("en");
});

describe("getReadableErrorMessage", () => {
	it("shows the upload size validation message instead of the generic oRPC error", () => {
		const error = new ORPCError("BAD_REQUEST", {
			message: "Input validation failed",
			data: { issues: [{ message: "File size must be less than 10MB", path: [] }] },
		});
		expect(getReadableErrorMessage(error, "Failed to upload picture.")).toBe("File size must be less than 10MB");
	});

	it("limits validation messages, removes duplicates, and ignores malformed issues", () => {
		const error = new ORPCError("BAD_REQUEST", {
			message: "Input validation failed",
			data: {
				issues: [
					null,
					{},
					{ message: 42 },
					{ message: " " },
					...["First", "First", "Second", "Third", "Fourth"].map((message) => ({ message })),
				],
			},
		});
		expect(getReadableErrorMessage(error, "fallback")).toBe("First Second Third");
	});

	it("returns the message of a plain error object (Better Auth client errors)", () => {
		expect(getReadableErrorMessage({ code: "SESSION_NOT_FRESH", message: "Session is not fresh" }, "fallback")).toBe(
			"Session is not fresh",
		);
	});
});

describe("connection and reply failures", () => {
	const offline = "Couldn't reach Reactive Resume. Check your internet connection, then try again.";

	it("names a lost connection in every browser's words, but not other type errors", () => {
		for (const message of ["Failed to fetch", "Load failed", "NetworkError when attempting to fetch resource."])
			expect(getOrpcErrorMessage(new TypeError(message), { fallback: "x", allowServerMessage: true })).toBe(offline);
		expect(getReadableErrorMessage(new TypeError("undefined is not a function"), "fallback")).toBe(
			"undefined is not a function",
		);
		expect(isProviderFailure(new TypeError("Failed to fetch"))).toBe(false);
	});

	it("translates the server's reply failures and offers another connection only for provider ones", () => {
		expect(getReadableErrorMessage(new Error(AGENT_REPLY_ERRORS.providerLimit), "fallback")).toContain("rate limit");
		expect(isProviderFailure(new Error(AGENT_REPLY_ERRORS.providerKey))).toBe(true);
		expect(isProviderFailure(new Error(AGENT_REPLY_ERRORS.failed))).toBe(false);
		// The server's own safe reasons pass through unchanged.
		const conflict = new ORPCError("CONFLICT", { message: "This conversation is still replying." });
		expect(getOrpcErrorMessage(conflict, { fallback: "x", allowServerMessage: true })).toBe(
			"This conversation is still replying.",
		);
		expect(isProviderFailure(conflict)).toBe(false);
	});
});

describe("getResumeErrorMessage", () => {
	it("maps INVALID_SLUG to the expected message", () => {
		const error = new ORPCError("INVALID_SLUG");
		expect(getResumeErrorMessage(error)).toBe(
			"Use at most 64 characters. The address must contain only lowercase letters and numbers, separated by single dashes.",
		);
	});

	it("maps RESUME_SLUG_ALREADY_EXISTS to the expected message", () => {
		const error = new ORPCError("RESUME_SLUG_ALREADY_EXISTS");
		expect(getResumeErrorMessage(error)).toBe("Another resume already uses this address. Choose a different one.");
	});

	it("maps RESUME_LOCKED to the expected message", () => {
		const error = new ORPCError("RESUME_LOCKED");
		expect(getResumeErrorMessage(error)).toBe("This resume is locked. Unlock it to make changes.");
	});

	it("falls back to generic message for unmapped orpc error", () => {
		const error = new ORPCError("UNKNOWN_ERROR");
		expect(getResumeErrorMessage(error)).toBe("Something went wrong. Please try again.");
	});
});

it("explains submitted-document recovery while keeping unrelated server errors private", () => {
	const error = new ORPCError("BAD_REQUEST", {
		message: "Internal details",
		data: { reason: SUBMITTED_DOCUMENT_LOCKED },
	});
	expect(getOrpcErrorMessage(error, { fallback: "Retry" })).toBe(
		"This application keeps the documents you submitted. Choose an application without a submitted letter, or duplicate the letter for another job.",
	);
	expect(
		getOrpcErrorMessage(new ORPCError("BAD_REQUEST", { message: "Internal details" }), { fallback: "Retry" }),
	).toBe("Retry");
});
