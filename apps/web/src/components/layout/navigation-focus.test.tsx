// @vitest-environment happy-dom
import { act, render, screen, waitFor } from "@testing-library/react";
import { expect, it } from "vite-plus/test";
import {
	createMemoryHistory,
	createRootRoute,
	createRoute,
	createRouter,
	HeadContent,
	Outlet,
	RouterProvider,
} from "@tanstack/react-router";
import { AlertDialog, AlertDialogContent, AlertDialogTitle } from "@reactive-resume/ui/components/alert-dialog";
import { Dialog, DialogContent, DialogTitle } from "@reactive-resume/ui/components/dialog";
import { NavigationFocus } from "./navigation-focus";
import { getPageTitle } from "@/libs/seo";

it.each(["dialog", "alertdialog"] as const)("retains initial %s focus when its route opens", async (role) => {
	const root = createRootRoute({
		component: () => (
			<>
				<NavigationFocus />
				<main>
					<h1>Background</h1>
				</main>
				{role === "dialog" ? (
					<Dialog open>
						<DialogContent>
							<DialogTitle>Save a job</DialogTitle>
							<input aria-label="Posting" />
						</DialogContent>
					</Dialog>
				) : (
					<AlertDialog open>
						<AlertDialogContent>
							<AlertDialogTitle>Delete account?</AlertDialogTitle>
							<input aria-label="Confirmation" />
						</AlertDialogContent>
					</AlertDialog>
				)}
			</>
		),
	});
	const route = createRoute({ getParentRoute: () => root, path: "/modal" });
	const router = createRouter({
		routeTree: root.addChildren([route]),
		history: createMemoryHistory({ initialEntries: ["/modal"] }),
	});
	render(<RouterProvider router={router} />);
	await waitFor(() => expect(screen.getByRole(role)).toBeVisible());
	await act(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
	expect(screen.getByRole("textbox")).toHaveFocus();
});

it("updates title and focus on path navigation, retaining field focus for search changes", async () => {
	const root = createRootRoute({
		component: () => (
			<>
				<HeadContent />
				<NavigationFocus />
				<Outlet />
			</>
		),
	});
	const one = createRoute({
		getParentRoute: () => root,
		path: "/one",
		component: () => (
			<main>
				<h1>One</h1>
			</main>
		),
		head: () => ({ meta: [{ title: getPageTitle("One") }] }),
	});
	const two = createRoute({
		getParentRoute: () => root,
		path: "/two",
		component: () => (
			<main>
				<h1>Two</h1>
				<input aria-label="Search" />
			</main>
		),
		head: () => ({ meta: [{ title: getPageTitle("Two") }] }),
	});
	const router = createRouter({
		routeTree: root.addChildren([one, two]),
		history: createMemoryHistory({ initialEntries: ["/one"] }),
	});
	render(<RouterProvider router={router} />);
	await waitFor(() => expect(screen.getByRole("heading", { name: "One" })).toHaveFocus());
	await router.navigate({ to: "/two" });
	await waitFor(() => expect(screen.getByRole("heading", { name: "Two" })).toHaveFocus());
	expect(document.title).toBe("Two | Reactive Resume");
	const field = screen.getByRole("textbox", { name: "Search" });
	field.focus();
	await router.navigate({ to: "/two", search: { q: "retained" } });
	expect(field).toHaveFocus();
});
