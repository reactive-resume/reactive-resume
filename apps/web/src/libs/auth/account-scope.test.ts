// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vite-plus/test";
import {
	getAccountGeneration,
	getAccountId,
	invalidateAccountScope,
	setAccountScope,
	subscribeAccountChange,
} from "./account-scope";

describe("account scope", () => {
	it("advances the generation only when the account actually changes", () => {
		invalidateAccountScope();
		setAccountScope("alice");
		const first = getAccountGeneration();
		expect(getAccountId()).toBe("alice");
		setAccountScope("alice");
		expect(getAccountGeneration()).toBe(first);
		setAccountScope("bob");
		expect(getAccountGeneration()).toBe(first + 1);
		expect(getAccountId()).toBe("bob");
	});

	it("clears the account and fences queued work on sign-out", () => {
		setAccountScope("alice");
		const before = getAccountGeneration();
		invalidateAccountScope();
		expect(getAccountId()).toBeNull();
		expect(getAccountGeneration()).toBe(before + 1);
	});

	it("fences this tab when another tab reports the account change", () => {
		setAccountScope("alice");
		const before = getAccountGeneration();
		const listener = vi.fn();
		const stop = subscribeAccountChange(listener);
		const event = new Event("storage");
		Object.defineProperty(event, "key", { value: "reactive-resume:account-change" });
		window.dispatchEvent(event);
		expect(listener).toHaveBeenCalledOnce();
		expect(getAccountId()).toBeNull();
		expect(getAccountGeneration()).toBe(before + 1);
		stop();
	});

	it("ignores unrelated storage keys", () => {
		const listener = vi.fn();
		const stop = subscribeAccountChange(listener);
		const event = new Event("storage");
		Object.defineProperty(event, "key", { value: "theme" });
		window.dispatchEvent(event);
		expect(listener).not.toHaveBeenCalled();
		stop();
	});
});
