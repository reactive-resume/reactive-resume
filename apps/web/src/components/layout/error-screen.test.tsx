// @vitest-environment happy-dom

import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vite-plus/test";
import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import {
	createMemoryHistory,
	createRootRoute,
	createRoute,
	createRouter,
	Outlet,
	RouterProvider,
} from "@tanstack/react-router";
import { ErrorScreen } from "./error-screen";

function Broken(): never {
	throw new Error("Failed to fetch dynamically imported module: /assets/renderers-secret.js");
}

it("shows the app's error screen when something outside every page fails, as a dialog does", async () => {
	i18n.load("en", {});
	i18n.activate("en");
	vi.spyOn(console, "error").mockImplementation(() => {});
	// Like the real root: the provider wraps the pages, and dialogs render beside them, under the root boundary only.
	const root = createRootRoute({
		component: () => (
			<I18nProvider i18n={i18n}>
				<Outlet />
				<Broken />
			</I18nProvider>
		),
	});
	const page = createRoute({ getParentRoute: () => root, path: "/", component: () => <p>Documents</p> });
	const router = createRouter({
		routeTree: root.addChildren([page]),
		history: createMemoryHistory({ initialEntries: ["/"] }),
		defaultErrorComponent: ErrorScreen,
	});

	render(<RouterProvider router={router} />);

	expect(await screen.findByText("This page didn't load")).toBeTruthy();
	expect(screen.getByRole("button", { name: "Reload" })).toBeTruthy();
	expect(document.body.textContent).not.toContain("renderers-secret");
	expect(document.body.textContent).not.toContain("Something went wrong");
});
