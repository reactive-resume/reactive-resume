import { t } from "@lingui/core/macro";
import { usePreventRemove } from "expo-router";
import { type ReactNode, useRef, useState } from "react";
import { View } from "react-native";
import { Button, Card, DiscardDialog, Skeleton, Text } from "@/ui";

export type ResourceStateProps = { pending: boolean; error: boolean; retry: () => void; children: ReactNode };
export function ResourceState({ pending, error, retry, children }: ResourceStateProps) {
	if (error)
		return (
			<View style={{ margin: 24 }}>
				<Card>
					<Text variant="body">{t`Couldn't load this. Try again.`}</Text>
					<Button label={t`Retry`} onPress={retry} />
				</Card>
			</View>
		);
	if (pending)
		return (
			<View style={{ padding: 24, gap: 12 }}>
				{[0, 1, 2].map((key) => (
					<Skeleton key={key} height={71} />
				))}
			</View>
		);
	return <>{children}</>;
}

export function useCareerLeaveGuard(dirty: boolean) {
	const [allowed, setAllowed] = useState(false);
	const saved = useRef(false);
	const [pending, setPending] = useState<{ repeat: () => void } | null>(null);
	usePreventRemove(dirty && !allowed, ({ repeat }) => {
		if (saved.current) {
			repeat();
			return;
		}
		setPending({ repeat });
	});
	return {
		allowLeave: () => {
			saved.current = true;
			setAllowed(true);
		},
		confirmation: (
			<DiscardDialog
				open={pending !== null}
				onKeep={() => setPending(null)}
				onDiscard={() => {
					setAllowed(true);
					pending?.repeat();
				}}
			/>
		),
	};
}
