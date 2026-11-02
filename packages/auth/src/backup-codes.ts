/**
 * Backup codes people copy onto paper for when their phone is gone: capitals and digits only, without the
 * characters that look alike in print (0/O, 1/I/L, 8/B), as two groups of five ("K7QXM-4PZR2").
 */
export const BACKUP_CODE_ALPHABET = "ACDEFGHJKMNPQRSTUVWXYZ234579";

const CODE_LENGTH = 10;

function randomCode(): string {
	let code = "";
	// Rejection sampling keeps every character equally likely.
	const limit = 256 - (256 % BACKUP_CODE_ALPHABET.length);
	while (code.length < CODE_LENGTH) {
		const bytes = crypto.getRandomValues(new Uint8Array(CODE_LENGTH * 2));
		for (const byte of bytes) {
			if (byte >= limit) continue;
			code += BACKUP_CODE_ALPHABET[byte % BACKUP_CODE_ALPHABET.length];
			if (code.length === CODE_LENGTH) break;
		}
	}
	return `${code.slice(0, 5)}-${code.slice(5)}`;
}

/** Ten new backup codes, for Better Auth's `twoFactor({ backupCodeOptions: { customBackupCodesGenerate } })`. */
export function generateBackupCodes(amount = 10): string[] {
	return Array.from({ length: amount }, randomCode);
}
