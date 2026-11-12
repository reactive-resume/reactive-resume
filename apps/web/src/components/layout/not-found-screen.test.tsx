// @vitest-environment happy-dom
import type { ReactNode } from "react";
import { render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vite-plus/test";
import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";

const context = vi.hoisted(() => ({ session: null as { user: { id: string } } | null }));
vi.mock("@tanstack/react-router", () => ({
	Link: ({ to, children, className }: { to: string; children: ReactNode; className?: string }) => (
		<a href={to} className={className}>
			{children}
		</a>
	),
	useRouteContext: () => ({ session: context.session }),
}));

import { NotFoundScreen } from "./not-found-screen";

i18n.loadAndActivate({ locale: "en", messages: {} });
const mount = (inLayout?: boolean) =>
	render(
		<I18nProvider i18n={i18n}>
			<NotFoundScreen {...(inLayout ? { inLayout } : {})} />
		</I18nProvider>,
	);

beforeEach(() => {
	context.session = null;
});

it("leads a signed-out visitor home, not to the dashboard", () => {
	mount();
	expect(screen.queryByRole("link", { name: /Go to Today/ })).toBeNull();
	expect(screen.getByRole("link", { name: /Go home/ }).getAttribute("href")).toBe("/");
});

it("offers the dashboard first to someone signed in", () => {
	context.session = { user: { id: "u" } };
	mount();
	const links = screen.getAllByRole("link").map((link) => link.textContent);
	expect(links).toEqual(["Go to Today", "Go home"]);
});
