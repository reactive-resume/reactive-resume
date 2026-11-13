import type { ResourceInput } from "./resources";
import { t } from "@lingui/core/macro";
import { dataClient } from "./client";
import { usePublicResume } from "./provider";
import { getServer, getAccountScope } from "@/auth/session";

export function usePublicResumeAccess(input: ResourceInput<"publicResume">) {
	const resume = usePublicResume(input);
	const server = getServer();
	const account = getAccountScope();
	return {
		...resume,
		viewer: resume.data ? (resume.data.name ? ("owner" as const) : ("visitor" as const)) : undefined,
		needsPassword: !!resume.error && "code" in resume.error && resume.error.code === "NEED_PASSWORD",
		async unlock(password: string) {
			const accepted = await dataClient.resume.verifyPassword({ ...input, password });
			if (getServer() !== server || getAccountScope() !== account) throw new Error(t`Server changed.`);
			if (accepted) await resume.refetch();
			return accepted;
		},
	};
}
