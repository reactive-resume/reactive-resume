import { expect, it } from "vite-plus/test";
import { BACKUP_CODE_ALPHABET, generateBackupCodes } from "./backup-codes";

it("makes ten distinct codes in two groups of five, from capitals and digits that don't look alike", () => {
	const codes = generateBackupCodes();
	expect(codes).toHaveLength(10);
	expect(new Set(codes).size).toBe(10);
	for (const code of codes) {
		expect(code).toMatch(/^[A-Z0-9]{5}-[A-Z0-9]{5}$/);
		for (const character of code.replace("-", "")) expect(BACKUP_CODE_ALPHABET).toContain(character);
	}
	expect(BACKUP_CODE_ALPHABET).not.toMatch(/[01OIL8B]/);
});
