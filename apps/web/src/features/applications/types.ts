import type { RouterOutput } from "@/libs/orpc/client";

export type Application = RouterOutput["applications"]["list"][number];
export type ApplicationSummary = RouterOutput["applications"]["listSummary"][number];
