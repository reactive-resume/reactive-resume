// A Menu anchored to the element that opened it (B1's long-press, B2's ···, B8's tap menu). Render `menu` in the
// screen's `overlay` slot so it sits outside the scroll view.
import { type ReactNode, useRef, useState } from "react";
import { type HostInstance, View } from "react-native";
import { Menu, MenuItem, type Rect } from "@/ui";

export type MenuAction = { label: string; onPress: () => void; danger?: boolean; disabled?: boolean };

export function useAnchoredMenu() {
	const [state, setState] = useState<{ anchor: Rect; actions: MenuAction[] } | null>(null);
	const open = (ref: React.RefObject<HostInstance | null>, actions: MenuAction[]) => {
		// An empty menu would draw as a bare 8 dp strip.
		if (!actions.some((a) => !a.disabled)) return;
		ref.current?.measureInWindow((x, y, width, height) => setState({ anchor: { x, y, width, height }, actions }));
	};
	const close = () => setState(null);
	const items = state?.actions.filter((a) => !a.disabled) ?? [];
	const menu = (
		<Menu
			open={!!state}
			onClose={close}
			anchor={state?.anchor ?? { x: 0, y: 0, width: 0, height: 0 }}
			height={items.length * 48 + 8}
		>
			{items.map((action) => (
				<MenuItem
					key={action.label}
					label={action.label}
					{...(action.danger ? { danger: true } : {})}
					onPress={() => {
						close();
						action.onPress();
					}}
				/>
			))}
		</Menu>
	);
	return { open, menu };
}

/** A measurable wrapper for a menu's trigger. */
export function Anchor({
	children,
	anchorRef,
}: {
	children: ReactNode;
	anchorRef: React.RefObject<HostInstance | null>;
}) {
	return (
		<View ref={anchorRef} collapsable={false}>
			{children}
		</View>
	);
}

export const useAnchorRef = () => useRef<HostInstance>(null);
