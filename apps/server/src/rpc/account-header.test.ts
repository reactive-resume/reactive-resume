import { describe, expect, it } from "vite-plus/test";
import { readAccountBinding } from "./account-header";

describe("readAccountBinding", () => {
	it.each(["x-account-id", "X-Account-Id", "X-ACCOUNT-ID", "X-Account-ID"])(
		"reads the binding regardless of header casing (%s)",
		(headerName) => {
			expect(readAccountBinding({ [headerName]: "bob" })).toBe("bob");
		},
	);

	it("treats repeated equal values as one binding", () => {
		expect(readAccountBinding({ "x-account-id": ["bob", "bob"] })).toBe("bob");
		expect(readAccountBinding({ "x-account-id": "bob", "X-Account-Id": "bob" })).toBe("bob");
	});

	it("keeps conflicting values from matching an account", () => {
		expect(readAccountBinding({ "x-account-id": ["alice", "bob"] })).toBe("alice, bob");
		expect(readAccountBinding({ "x-account-id": "alice", "X-Account-Id": "bob" })).toBe("alice, bob");
	});

	it.each([undefined, "", "   "])("treats an absent or empty binding as legacy (%j)", (value) => {
		expect(readAccountBinding(value === undefined ? {} : { "x-account-id": value })).toBeUndefined();
	});

	it("ignores headers that are not the binding", () => {
		expect(readAccountBinding({ cookie: "session=1", authorization: "Bearer token" })).toBeUndefined();
	});

	it("ignores malformed header names without losing a valid binding", () => {
		expect(readAccountBinding({ "bad header": "value", "x-account-id": "bob" })).toBe("bob");
	});
});
