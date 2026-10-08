// @vitest-environment happy-dom

import type { ComponentProps } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";

const mocks = vi.hoisted(() => ({
	callbackURL: "/api/auth/oauth?client_id=client&resource=https%3A%2F%2Fresume.example%2Fmcp&exp=123&sig=456",
	navigate: vi.fn(),
	invalidate: vi.fn(),
	email: vi.fn(),
	username: vi.fn(),
	social: vi.fn(),
	passkey: vi.fn(),
	verifyTotp: vi.fn(),
	verifyBackupCode: vi.fn(),
	signup: vi.fn(),
	continueOAuth: vi.fn(),
	queryClient: { invalidateQueries: vi.fn(async () => {}) },
}));

vi.mock("@tanstack/react-query", () => ({
	useQuery: () => ({
		data: { google: "Google", github: "GitHub", linkedin: "LinkedIn", custom: "SSO", passkey: true },
	}),
	useQueryClient: () => mocks.queryClient,
}));
vi.mock("@tanstack/react-router", () => ({
	useSearch: () => ({ callbackURL: mocks.callbackURL }),
	useRouter: () => ({ navigate: mocks.navigate, invalidate: mocks.invalidate }),
	useNavigate: () => mocks.navigate,
	Link: ({ to, search: _search, ...props }: ComponentProps<"a"> & { to: string; search?: unknown }) => (
		// oxlint-disable-next-line jsx-a11y/anchor-has-content -- The Link mock forwards children through props.
		<a href={to} {...props} />
	),
}));
vi.mock("@/libs/orpc/client", () => ({ orpc: { auth: { providers: { list: { queryOptions: () => ({}) } } } } }));
vi.mock("@/libs/auth/client", () => ({
	authClient: {
		signUp: { email: mocks.signup },
		oauth2: { continue: mocks.continueOAuth },
		twoFactor: { verifyTotp: mocks.verifyTotp, verifyBackupCode: mocks.verifyBackupCode },
		signIn: { email: mocks.email, username: mocks.username, social: mocks.social, passkey: mocks.passkey },
	},
}));
vi.mock("@reactive-resume/ui/components/toast", () => ({ toast: { add: vi.fn(), close: vi.fn() } }));

import { LoginPage } from "./pages/login";
import { RegisterPage } from "./pages/register";
import { VerifyTwoFactorBackupPage, VerifyTwoFactorPage } from "./pages/verify-2fa";

beforeEach(() => {
	vi.clearAllMocks();
	mocks.callbackURL = "/api/auth/oauth?client_id=client&resource=https%3A%2F%2Fresume.example%2Fmcp&exp=123&sig=456";
	i18n.loadAndActivate({ locale: "en-US", messages: {} });
	mocks.invalidate.mockResolvedValue(undefined);
	for (const signIn of [
		mocks.email,
		mocks.username,
		mocks.social,
		mocks.passkey,
		mocks.verifyTotp,
		mocks.verifyBackupCode,
		mocks.signup,
		mocks.continueOAuth,
	])
		signIn.mockResolvedValue({ data: {}, error: null });
});
afterEach(cleanup);

function renderLogin() {
	return render(
		<I18nProvider i18n={i18n}>
			<LoginPage disableEmailAuth={false} disableSignups={false} />
		</I18nProvider>,
	);
}

function submitLogin(container: HTMLElement, identifier: string, passwordValue = "password123") {
	const input = container.querySelector('input[name="identifier"]');
	const password = container.querySelector('input[name="password"]');
	const form = container.querySelector("form");
	if (!input || !password || !form) throw new Error("Login form is missing");
	fireEvent.change(input, { target: { value: identifier } });
	fireEvent.change(password, { target: { value: passwordValue } });
	fireEvent.submit(form);
}

describe("OAuth callback after sign-in", () => {
	it("accepts a legacy password and prevents duplicate sign-in until a failed request finishes", async () => {
		let finish: (() => void) | undefined;
		mocks.email.mockReturnValue(
			new Promise((resolve) => {
				finish = () => resolve({ error: { message: "Invalid credentials" } });
			}),
		);
		const { container } = renderLogin();
		const submit = screen.getByRole<HTMLButtonElement>("button", { name: "Sign in" });
		submitLogin(container, "john@example.com", "old123");
		await waitFor(() => expect(mocks.email).toHaveBeenCalledOnce());
		expect(mocks.email).toHaveBeenCalledWith(expect.objectContaining({ password: "old123" }));
		expect(submit.disabled).toBe(true);
		fireEvent.click(submit);
		expect(mocks.email).toHaveBeenCalledOnce();
		finish?.();
		await waitFor(() => expect(submit.disabled).toBe(false));
		expect(mocks.navigate).not.toHaveBeenCalled();
	});

	it.each(["john@example.com", "john"])(
		"resumes the signed server callback after email/username sign-in (%s)",
		async (identifier) => {
			const { container } = renderLogin();
			submitLogin(container, identifier);
			await waitFor(() =>
				expect(mocks.navigate).toHaveBeenCalledWith({ href: mocks.callbackURL, reloadDocument: true, replace: true }),
			);
		},
	);

	it.each([
		["Google", "google"],
		["GitHub", "github"],
		["LinkedIn", "linkedin"],
		["SSO", "custom"],
	])("passes the callback to %s sign-in", async (label, provider) => {
		renderLogin();
		fireEvent.click(screen.getByRole("button", { name: label }));
		await waitFor(() =>
			expect(mocks.social).toHaveBeenCalledWith({
				provider,
				callbackURL: mocks.callbackURL,
				oauth_query: mocks.callbackURL.split("?")[1],
			}),
		);
	});

	it("resumes the callback after passkey sign-in", async () => {
		renderLogin();
		fireEvent.click(screen.getByRole("button", { name: "Passkey" }));
		await waitFor(() =>
			expect(mocks.navigate).toHaveBeenCalledWith({ href: mocks.callbackURL, reloadDocument: true, replace: true }),
		);
	});

	it("carries the callback into two-factor verification", async () => {
		mocks.email.mockResolvedValueOnce({ data: { twoFactorRedirect: true }, error: null });
		const { container } = renderLogin();
		submitLogin(container, "john@example.com");
		await waitFor(() =>
			expect(mocks.navigate).toHaveBeenCalledWith({
				to: "/auth/verify-2fa",
				search: { callbackURL: mocks.callbackURL },
				replace: true,
			}),
		);
	});

	it("lets the provider finish its validated redirect after fresh authentication", async () => {
		mocks.email.mockResolvedValueOnce({
			data: { redirect: true, url: "http://127.0.0.1:1234/callback?code=code" },
			error: null,
		});
		const { container } = renderLogin();
		submitLogin(container, "john@example.com");
		await waitFor(() =>
			expect(mocks.email).toHaveBeenCalledWith(
				expect.objectContaining({ oauth_query: mocks.callbackURL.split("?")[1] }),
			),
		);
		expect(mocks.navigate).not.toHaveBeenCalled();
	});
});

describe("OAuth callback after two-factor verification", () => {
	it.each(["82cNKqaOiN", "82cNK-qaOiN"])("submits a complete backup code entered as %s", async (code) => {
		const { container } = render(
			<I18nProvider i18n={i18n}>
				<VerifyTwoFactorBackupPage />
			</I18nProvider>,
		);
		const input = container.querySelector<HTMLInputElement>('input[name="code"]');
		const form = container.querySelector("form");
		if (!input || !form) throw new Error("Verification form is missing");
		expect(input.maxLength).toBeGreaterThanOrEqual(code.length);
		fireEvent.change(input, { target: { value: code } });
		fireEvent.submit(form);
		await waitFor(() =>
			expect(mocks.verifyBackupCode).toHaveBeenCalledWith(expect.objectContaining({ code: "82cNK-qaOiN" })),
		);
	});
	it.each([false, true])("resumes the callback after verifying a code (backup: %s)", async (backup) => {
		const { container } = render(
			<I18nProvider i18n={i18n}>{backup ? <VerifyTwoFactorBackupPage /> : <VerifyTwoFactorPage />}</I18nProvider>,
		);
		const input = container.querySelector('input[name="code"]');
		const form = container.querySelector("form");
		if (!input || !form) throw new Error("Verification form is missing");
		fireEvent.change(input, { target: { value: backup ? "abcde12345" : "123456" } });
		fireEvent.submit(form);
		await waitFor(() =>
			expect(mocks.navigate).toHaveBeenCalledWith({ href: mocks.callbackURL, reloadDocument: true, replace: true }),
		);
	});
});

describe("OAuth account creation", () => {
	it("rejects a seven-character new password before contacting auth", async () => {
		const { container } = render(
			<I18nProvider i18n={i18n}>
				<RegisterPage disableEmailAuth={false} />
			</I18nProvider>,
		);
		for (const [name, value] of Object.entries({
			name: "New User",
			username: "newuser",
			email: "new@example.com",
			password: "1234567",
		})) {
			const input = container.querySelector(`input[name="${name}"]`);
			if (!input) throw new Error(`Missing ${name} field`);
			fireEvent.change(input, { target: { value } });
		}
		const form = container.querySelector("form");
		if (!form) throw new Error("Missing registration form");
		fireEvent.submit(form);
		await waitFor(() => expect(screen.getByText(/>=8/)).toBeDefined());
		expect(mocks.signup).not.toHaveBeenCalled();
	});
	it("continues a create prompt only after successful signup", async () => {
		mocks.callbackURL += "&prompt=create";
		mocks.signup.mockResolvedValueOnce({ data: { token: "session" }, error: null });
		mocks.continueOAuth.mockResolvedValueOnce({
			data: { redirect: true, url: "/api/auth/oauth?sig=next" },
			error: null,
		});
		const { container } = render(
			<I18nProvider i18n={i18n}>
				<RegisterPage disableEmailAuth={false} />
			</I18nProvider>,
		);
		for (const [name, value] of Object.entries({
			name: "New User",
			username: "newuser",
			email: "new@example.com",
			password: "password123",
		})) {
			const input = container.querySelector(`input[name="${name}"]`);
			if (!input) throw new Error(`Missing ${name} field`);
			fireEvent.change(input, { target: { value } });
		}
		const form = container.querySelector("form");
		if (!form) throw new Error("Missing registration form");
		fireEvent.submit(form);
		await waitFor(() =>
			expect(mocks.continueOAuth).toHaveBeenCalledWith({ created: true, oauth_query: mocks.callbackURL.split("?")[1] }),
		);
		expect(mocks.signup.mock.calls[0]?.[0]).not.toHaveProperty("oauth_query");
	});
});
