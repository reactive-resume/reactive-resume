// @vitest-environment happy-dom
import type { ReactNode } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vite-plus/test";
import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";

vi.mock("./scroll", () => ({
	SCENE: { tailor: "tailor" },
	useLanding: (selector: (state: { keywordCount: number }) => unknown) => selector({ keywordCount: 0 }),
}));
vi.mock("./sheet", () => ({ Sheet: () => null }));
vi.mock("./ui", () => ({
	Doodle: () => null,
	labelClass: "",
	SceneCaption: ({ children }: { children: ReactNode }) => <section>{children}</section>,
	Stamp: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));

const { Tailor } = await import("./tailor");

afterEach(cleanup);

it("describes a fit check against each requirement instead of a match score", () => {
	i18n.loadAndActivate({ locale: "en", messages: {} });
	render(
		<I18nProvider i18n={i18n}>
			<Tailor />
		</I18nProvider>,
	);
	expect(screen.getByText(/a fit check against each requirement/)).toBeTruthy();
	expect(screen.queryByText(/match score/i)).toBeNull();
});
