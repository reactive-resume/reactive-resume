export const TRUSTED_IP_HEADERS = [
	"CF-Connecting-IP",
	"CF-Connecting-IPv6",
	"True-Client-IP",
	"X-Forwarded-For",
	"X-Real-IP",
];

export const rateLimitConfig = {
	betterAuth: {
		global: {
			enabled: true,
			window: 60,
			max: 60,
			customRules: {
				"/sign-in/email": { window: 60, max: 5 },
				"/sign-up/email": { window: 60, max: 3 },
				"/request-password-reset": { window: 600, max: 3 },
				"/send-verification-email": { window: 600, max: 3 },
				"/two-factor/verify-otp": { window: 600, max: 5 },
				"/two-factor/verify-totp": { window: 600, max: 5 },
				"/two-factor/verify-backup-code": { window: 600, max: 5 },
				"/is-username-available": { window: 60, max: 20 },
			},
		},
		oauthProvider: {
			register: { window: 60, max: 5 },
			authorize: { window: 60, max: 30 },
			token: { window: 60, max: 20 },
			introspect: { window: 60, max: 60 },
			revoke: { window: 60, max: 30 },
			userinfo: { window: 60, max: 60 },
		},
		apiKey: {
			enabled: true,
			timeWindow: 60 * 60 * 1000,
			maxRequests: 1000,
		},
	},
	orpc: {
		resumePassword: { maxRequests: 5, window: 10 * 60 * 1000 },
		critiquePassword: { maxRequests: 5, window: 10 * 60 * 1000 },
		pdfExport: { maxRequests: 5, window: 60 * 1000 },
		aiRequest: { maxRequests: 20, window: 60 * 1000 },
		storageUpload: { maxRequests: 20, window: 60 * 1000 },
		storageDelete: { maxRequests: 30, window: 60 * 1000 },
		resumeMutations: { maxRequests: 300, window: 60 * 1000 },
	},
} as const;
