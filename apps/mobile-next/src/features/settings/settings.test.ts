import { emptyProfile, fromFields, toFields } from "./profile-fields";
import { failureFromError, totalPending } from "./sign-out";

const counts = { documents: 2, letters: 0, profile: 1, "stories-and-facts": 0, applications: 0 };

describe("S8", () => {
	it("counts what's queued", () => {
		expect(totalPending(counts)).toBe(3);
	});

	it("names each sync failure from its code", () => {
		expect(failureFromError({ code: "OFFLINE" })).toBe("offline");
		expect(failureFromError({ code: "SESSION_EXPIRED" })).toBe("session-expired");
		expect(failureFromError({ code: "CONFLICT" })).toBe("conflict");
		expect(failureFromError(new Error("timeout"))).toBe("no-response");
	});
});

describe("S4 fields", () => {
	it("round-trips the drawn fields without losing the rest of the profile", () => {
		const base = { ...emptyProfile(), givenName: "Alex", familyName: "Morgan", willingToRelocate: "yes" as const };
		const next = fromFields(base, { ...toFields(base, "en"), name: "Alex de Morgan", linkedIn: "linkedin.com/in/a" });
		expect(next.givenName).toBe("Alex");
		expect(next.familyName).toBe("de Morgan");
		expect(next.links).toEqual([{ label: "LinkedIn", url: "https://linkedin.com/in/a" }]);
		expect(next.willingToRelocate).toBe("yes");
	});
});
