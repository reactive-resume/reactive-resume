import { describe, expect, it } from "vite-plus/test";
import { resumeDto } from "./resume";

describe("expected revision on lock, password and link writes", () => {
	it("refuses null instead of reading it as 1970", () => {
		expect(resumeDto.setLocked.input.safeParse({ id: "r1", isLocked: true, expectedUpdatedAt: null }).success).toBe(
			false,
		);
	});

	it("takes a timestamp, and leaves the check out when it's missing", () => {
		const parsed = resumeDto.setLocked.input.parse({
			id: "r1",
			isLocked: true,
			expectedUpdatedAt: "2026-01-01T00:00:00Z",
		});
		expect(parsed.expectedUpdatedAt).toEqual(new Date("2026-01-01T00:00:00Z"));
		expect(resumeDto.setLocked.input.parse({ id: "r1", isLocked: true }).expectedUpdatedAt).toBeUndefined();
	});
});
