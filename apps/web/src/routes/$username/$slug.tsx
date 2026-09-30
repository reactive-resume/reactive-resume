import { createFileRoute, Outlet } from "@tanstack/react-router";

// Pathless layout: the exact-match public resume page lives in $slug.index.tsx, and the
// feedback/critique page lives in $slug.critique.tsx. Neither shares a loader or shell, so
// this layout only exists to let both live under the same /$username/$slug path segment.
export const Route = createFileRoute("/$username/$slug")({
	component: () => <Outlet />,
});
