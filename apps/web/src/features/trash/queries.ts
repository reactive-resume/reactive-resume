import { orpc } from "@/libs/orpc/client";

/** How many rows of each kind Trash loads at a time (the server's page size). */
export const TRASH_PAGE = 100;

/** Applications in Trash. The navigation reads its total from the first page, which the Trash page shares. */
export const trashedApplicationsQueryOptions = (offset = 0) =>
	orpc.applications.listTrash.queryOptions({ input: { limit: TRASH_PAGE, offset } });
