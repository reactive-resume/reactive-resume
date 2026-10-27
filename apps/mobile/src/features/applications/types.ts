import type { RouterOutput } from "@/api/client";

export type Application = RouterOutput["applications"]["list"][number];
export type ApplicationSummary = RouterOutput["applications"]["listSummary"][number];
