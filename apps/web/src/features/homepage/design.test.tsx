// @vitest-environment happy-dom
import type { ReactNode } from "react";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vite-plus/test";
import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { createMemoryHistory, createRootRoute, createRouter, RouterContextProvider } from "@tanstack/react-router";
import { Design } from "./design";
import { useLanding } from "./scroll";

vi.mock("./sheet", () => ({
	Sheet: () => null,
	sheetTemplates: ["Classic", "Sidebar", "Banner", "Mono", "Editorial"].map((name) => ({
		name: { id: name, message: name },
	})),
}));
vi.mock("./ui", () => ({
	Doodle: () => null,
	SceneCaption: ({ children }: { children: ReactNode }) => <section>{children}</section>,
}));

afterEach(() => {
	cleanup();
	useLanding.setState({ designExiting: false, designZoomed: false });
});

it("releases focus and makes the closing link inert when Design exits", async () => {
	i18n.loadAndActivate({ locale: "en", messages: {} });
	const router = createRouter({
		routeTree: createRootRoute(),
		history: createMemoryHistory({ initialEntries: ["/"] }),
	});
	await router.load();
	useLanding.setState({ designExiting: false, designZoomed: true });

	render(
		<RouterContextProvider router={router}>
			<I18nProvider i18n={i18n}>
				<Design />
			</I18nProvider>
		</RouterContextProvider>,
	);

	const link = screen.getByRole("link");
	link.focus();
	expect(document.activeElement).toBe(link);
	expect(link.hasAttribute("inert")).toBe(false);

	act(() => useLanding.setState({ designExiting: true }));

	await waitFor(() => expect(link.hasAttribute("inert")).toBe(true));
	expect(document.activeElement).not.toBe(link);
});
