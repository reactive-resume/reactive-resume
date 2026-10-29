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
		queryKey: ["applications-prior-no-response", getServer(), scope, lookup, excludeId],
		queryFn: ({ signal }) =>
			client.applications.priorNoResponse(
				{ company: lookup, ...(excludeId ? { excludeId } : {}) },
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
			<Banner
				tone="info"
				message={t`A previous application to this company was closed with No response. You can still apply.`}
			/>
			{query.data.map((application) => (
				<Button
					key={application.id}
					variant="link"
					disabled={disabled}
					label={`${application.role} · ${application.company}`}
					onPress={() => {
						if (onOpen?.(application.id) === false) return;
						router.push(routes.applicationDetails(application.id));
					}}
				/>
			))}
		</View>
	);
}
