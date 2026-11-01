import { createFileRoute, lazyRouteComponent } from "@tanstack/react-router";
import { PagePlaceholder } from "./-components/editor-pending";

export const Route = createFileRoute("/builder/$resumeId/")({
	component: lazyRouteComponent(() => import("./-components/page-canvas"), "PageCanvas"),
	pendingComponent: PagePlaceholder,
});
