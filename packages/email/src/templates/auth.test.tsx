import { describe, expect, it } from "vite-plus/test";
import { render } from "react-email";
import { resetPasswordEmail, verifyEmail, verifyEmailChange } from "./auth";

/** The opening tag's attributes, in any order. */
const tag = (html: string, name: string) => html.match(new RegExp(`<${name}\\b[^>]*>`))?.[0] ?? "";

const url = "https://rxresu.me/api/auth/verify-email?token=signed.token-value&callbackURL=%2Fdashboard";

describe("account emails", () => {
	it("keep the English text, link and plain-text copy for an English account", async () => {
		const email = verifyEmail({ url, locale: "en-US" });
		const html = await render(email.react);
		const text = await render(email.react, { plainText: true });

		expect(email.subject).toBe("Verify your email");
		expect(tag(html, "html")).toContain('lang="en-US"');
		expect(tag(html, "html")).toContain('dir="ltr"');
		expect(html).toContain("Thanks for signing up for Reactive Resume. Verify your email address to continue.");
		expect(html).toContain(`href="${url.replaceAll("&", "&amp;")}"`);
		expect(text).toContain(url);
	});

	it("go out right to left in Arabic, with the link unchanged", async () => {
		for (const email of [verifyEmail({ url, locale: "ar-SA" }), resetPasswordEmail({ url, locale: "ar-SA" })]) {
			const html = await render(email.react);
			const text = await render(email.react, { plainText: true });

			expect(email.subject).toMatch(/[؀-ۿ]/);
			for (const name of ["html", "body"]) {
				expect(tag(html, name)).toContain('lang="ar-SA"');
				expect(tag(html, name)).toContain('dir="rtl"');
			}
			expect(html).not.toContain('lang="en"');
			expect(html).not.toContain("If the button does not work");
			expect(html).toContain(`href="${url.replaceAll("&", "&amp;")}"`);
			expect(text).toContain(url);
		}
	});

	it("names both addresses in a translated email change approval", async () => {
		const email = verifyEmailChange({
			url,
			previousEmail: "layla@example.test",
			newEmail: "new-address@example.test",
			locale: "ar-SA",
		});
		const text = await render(email.react, { plainText: true });

		expect(email.subject).toBe("الموافقة على تغيير بريدك الإلكتروني");
		expect(text).toContain("layla@example.test");
		expect(text.match(/new-address@example\.test/g)).toHaveLength(2);
		expect(text).not.toMatch(/\{(previousEmail|newEmail|appName)\}/);
	});
});
