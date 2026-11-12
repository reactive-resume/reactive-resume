import { t } from "@lingui/core/macro";
import { useRouter } from "expo-router";
// Small pieces the Applications and workspace screens share, built only from design-system parts.
import { type ReactNode, useRef, useState } from "react";
import { type HostInstance, View } from "react-native";
import Animated from "react-native-reanimated";
import { useAccount } from "@/data";
import {
	AvatarButton,
	BottomSheet,
	Button,
	HeroCard,
	IconButton,
	layout,
	ListRow,
	Menu,
	type Rect,
	motion,
	Radio,
	selectRadio,
	Skeleton,
	Text,
	useFadeUp,
} from "@/ui";

/** Content that fades in when it (re)mounts: key it by what changed (views, kinds, drafts). d2 unless given. */
export function FadeIn({ children, ms = motion.d2, px = 0 }: { children: ReactNode; ms?: number; px?: number }) {
	const style = useFadeUp({ px, ms });
	return <Animated.View style={style}>{children}</Animated.View>;
}

/** The root tabs' avatar: initials from the account, opens Settings. */
export function SettingsAvatar() {
	const router = useRouter();
	const account = useAccount();
	const name = account.data?.name ?? "";
	const initials = name
		.split(/\s+/)
		.map((part) => part[0] ?? "")
		.join("")
		.slice(0, 2)
		.toLocaleUpperCase();
	return <AvatarButton initials={initials} onPress={() => router.push("/settings")} />;
}

/** The Applications tab's two header icons. */
export function ApplicationsActions() {
	const router = useRouter();
	return (
		<>
			<IconButton icon="chart-line-up" label={t`Insights`} onPress={() => router.push("/applications/insights")} />
			<IconButton icon="plus" label={t`Save a job`} onPress={() => router.push("/applications/new")} />
		</>
	);
}

/** Still placeholders at the final size of 64 dp rows (MOTION.md §8). */
export function RowPlaceholders({ count = 3 }: { count?: number }) {
	return (
		<View style={{ paddingHorizontal: layout.screenMargin }}>
			{Array.from({ length: count }, (_, i) => (
				<View key={i} style={{ height: 71, flexDirection: "row", alignItems: "center", gap: 16 }}>
					<Skeleton width={40} height={40} radius={10} />
					<View style={{ flex: 1, gap: 6 }}>
						<Skeleton width="50%" height={16} />
						<Skeleton width="70%" height={14} />
					</View>
				</View>
			))}
		</View>
	);
}

/** "Couldn't load this. Your saved data hasn't changed." with Try again. */
export function LoadError({ onRetry }: { onRetry: () => void }) {
	return (
		<HeroCard title={t`Couldn't load this`} body={t`Couldn't load this. Your saved data hasn't changed.`}>
			<Button label={t`Try again`} tone="secondary" size="lg" block onPress={onRetry} />
		</HeroCard>
	);
}

export type Choice<K extends string> = { key: K; title: string; secondary?: string | undefined; trailing?: ReactNode };

/** A sheet of radio rows (stage lists, outcomes, kinds): choosing one closes it. */
export function ChoiceSheet<K extends string>({
	title,
	choices,
	value,
	onChoose,
	onClose,
	height,
}: {
	title: string;
	choices: readonly Choice<K>[];
	value?: K | undefined;
	onChoose: (key: K) => void;
	onClose: () => void;
	height: number;
}) {
	return (
		<BottomSheet title={title} height={height} onClose={onClose}>
			<View style={{ paddingTop: 8 }}>
				{choices.map((choice, i) => (
					<ListRow
						key={choice.key}
						title={choice.title}
						secondary={choice.secondary}
						leading={<Radio selected={choice.key === value} interactive={false} />}
						trailing={choice.trailing}
						accessibilityRole="radio"
						accessibilityState={{ selected: choice.key === value }}
						last={i === choices.length - 1}
						onPress={() => selectRadio(choice.key === value, () => onChoose(choice.key))}
					/>
				))}
			</View>
		</BottomSheet>
	);
}

/** A quiet 14/20 line in 24 dp margins (sheet notes, provenance lines). */
export function QuietLine({ children, top = 0, bottom = 0 }: { children: string; top?: number; bottom?: number }) {
	return (
		<View style={{ paddingTop: top, paddingBottom: bottom, paddingHorizontal: layout.screenMargin }}>
			<Text variant="ui" color="ink3">
				{children}
			</Text>
		</View>
	);
}

/** A bar button that opens a Menu under itself: render `button` in the bar and `menu(children)` as the screen overlay. */
export function useBarMenu() {
	const ref = useRef<HostInstance>(null);
	const [anchor, setAnchor] = useState<Rect | null>(null);
	const open = () => ref.current?.measureInWindow((x, y, width, height) => setAnchor({ x, y, width, height }));
	const close = () => setAnchor(null);
	return {
		open,
		close,
		wrap: (button: ReactNode) => (
			<View ref={ref} collapsable={false}>
				{button}
			</View>
		),
		menu: (children: ReactNode, width = 240) => (
			<Menu
				open={anchor !== null}
				onClose={close}
				anchor={anchor ?? { x: 0, y: 0, width: 0, height: 0 }}
				align="end"
				width={width}
			>
				{children}
			</Menu>
		),
	};
}
