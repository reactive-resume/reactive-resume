import { createFileRoute } from "@tanstack/react-router";
import { ProfileSettings } from "@/features/settings/profile";

export const Route = createFileRoute("/dashboard/settings/profile")({ component: ProfileSettings });
