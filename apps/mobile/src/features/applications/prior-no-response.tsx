import type { ApplicationClosedReason } from "@reactive-resume/schema/applications/data";
import { t } from "@lingui/core/macro";
import { useLingui } from "@lingui/react/macro";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { View } from "react-native";
import { useApplicationLanes } from "./lane-queries";
import { client } from "@/api/client";
import { getAccountScope, getServer } from "@/auth/session";
import { routes } from "@/routes";
import { Banner, Button, useTheme } from "@/ui";

/**
 * How an earlier application ended, for the list under the notice. A server from before `anyOutcome` returns rows
 * without `closedReason`, and only no-response ones, so a missing reason reads as "no reply".
 */
const outcomeText = (reason: ApplicationClosedReason | null) =>
	reason === "no-response"
		? t`no reply`
		: reason === "not-selected"
			? t`not selected`
			: reason === "withdrew"
				? t`you withdrew`
				: reason === "accepted"
					? t`you accepted an offer`
					: reason === "accepted-other"
						? t`you took another offer`
						: t`closed`;

type PriorNoResponseProps = {
	company: string;
	excludeId?: string;
	disabled?: boolean;
	onOpen?: (id: string) => boolean | void;
};
export function PriorNoResponse({ company, excludeId, disabled, onOpen }: PriorNoResponseProps) {
	const { t } = useLingui();
	const { space } = useTheme();
	const router = useRouter();
	const lanes = useApplicationLanes();
	const scope = getAccountScope();
	const normalized = company.trim();
	const [lookup, setLookup] = useState(normalized);
	useEffect(() => {
		const timer = setTimeout(() => setLookup(normalized), 300);
		return () => clearTimeout(timer);
	}, [normalized]);
	const query = useQuery({
		queryKey: ["applications-prior-outcomes", getServer(), scope, lookup, excludeId],
		queryFn: ({ signal }) =>
			client.applications.priorNoResponse(
				{ company: lookup, anyOutcome: true, ...(excludeId ? { excludeId } : {}) },
				{ signal, context: { scope: scope ?? undefined } },
			),
		enabled: lanes.supported && lookup.length > 0 && lookup === normalized,
		staleTime: 30_000,
	});
	if (lookup !== normalized) return null;
	if (query.isError)
		return (
			<Banner
				tone="warn"
				message={t`Couldn't check prior applications. You can still save this application.`}
				action={{ label: t`Retry`, onPress: () => void query.refetch() }}
			/>
		);
	if (!query.data?.length) return null;
	return (
		<View style={{ gap: space.s2 }}>
			<Banner tone="info" message={t`You applied to this company before. You can still apply.`} />
			{query.data.map((application) => (
				<Button
					key={application.id}
					variant="link"
					disabled={disabled}
					label={`${application.role} · ${application.company} · ${outcomeText(application.closedReason === undefined ? "no-response" : application.closedReason)}`}
					onPress={() => {
						if (onOpen?.(application.id) === false) return;
						router.push(routes.applicationDetails(application.id));
					}}
				/>
			))}
		</View>
	);
}
