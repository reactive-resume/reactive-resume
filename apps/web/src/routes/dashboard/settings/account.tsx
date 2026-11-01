import { t } from "@lingui/core/macro";
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { AccountSettings } from "@/features/settings/account/page";
import { getPageTitle } from "@/libs/seo";

export const Route = createFileRoute("/dashboard/settings/account")({
	head: () => ({ meta: [{ title: getPageTitle(t`Account`) }] }),
	validateSearch: z.object({ deleteAccount: z.boolean().optional().catch(false) }),
	component: AccountSettings,
});
