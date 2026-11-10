// Shared elements (MOTION.md §6.2): D1 thumbnail → B1 page band; B1, B6, L2 page → B18; J1 company → J6 title.
// The destination screen fades in (stackOptions 'fade', d3 `ease`) while the element travels from its source rect to
// its destination rect in <HeroOverlay /> (mounted at the root, above the navigator), d3 `ease-drawer`, translate and
// scale only. Source and destination are hidden while it flies; on landing the destination shows in the same frame.
// Pages render the destination image at the destination size, scaled to the source at the start. Text passes
// `renderFrom` too: the two crossfade over the first 60%. Back: flyBack() reverses in 224 ms. Reduced motion: no
// travel (the screen's d1 crossfade carries it). Unmeasurable rects: prepareHero() returns false, push normally.
//   source: <HeroSource id="page">…</HeroSource>; onPress: await prepareHero("page", renderPage); router.push(…)
//   destination: <HeroTarget id="page">…</HeroTarget>
import { type ReactNode, type RefObject, useEffect, useRef } from "react";
import { type HostInstance, I18nManager, type StyleProp, StyleSheet, View, type ViewStyle } from "react-native";
import Animated, { interpolate, runOnJS, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { create } from "zustand";
import { curve, enter, leave, useMotionPolicy } from "./motion";
import { motion } from "./tokens";

export type HeroRect = { x: number; y: number; width: number; height: number };
type Render = (size: { width: number; height: number }) => ReactNode;
type Flight = { id: string; from: HeroRect; to: HeroRect; render: Render; renderFrom?: Render; back: boolean };
type Pending = { id: string; from: HeroRect; render: Render; renderFrom?: Render };

type HeroState = { flight: Flight | null; pending: Pending | null };
const useHero = create<HeroState>(() => ({ flight: null, pending: null }));
const sources = new Map<string, RefObject<HostInstance | null>>();
const targets = new Map<string, RefObject<HostInstance | null>>();
const flights = new Map<string, { render: Render; renderFrom?: Render }>();

const measure = (ref: RefObject<HostInstance | null> | undefined) =>
	new Promise<HeroRect | null>((resolve) => {
		const node = ref?.current;
		if (!node) return resolve(null);
		node.measureInWindow((x, y, width, height) => resolve(width > 0 && height > 0 ? { x, y, width, height } : null));
	});

/** Measure the source before navigating. False when it can't be measured: push without a hero. */
export async function prepareHero(id: string, render: Render, renderFrom?: Render): Promise<boolean> {
	const from = await measure(sources.get(id));
	if (!from) return false;
	flights.set(id, { render, ...(renderFrom ? { renderFrom } : {}) });
	useHero.setState({ pending: { id, from, render, ...(renderFrom ? { renderFrom } : {}) } });
	return true;
}

/** Before going back: fly the destination element home (224 ms). False when either end can't be measured. */
export async function flyBack(id: string): Promise<boolean> {
	const [from, to] = await Promise.all([measure(targets.get(id)), measure(sources.get(id))]);
	const f = flights.get(id);
	if (!from || !to || !f) return false;
	// The overlay always draws at the larger (destination) rect: `to` of the forward flight.
	useHero.setState({
		flight: {
			id,
			from: to,
			to: from,
			render: f.render,
			...(f.renderFrom ? { renderFrom: f.renderFrom } : {}),
			back: true,
		},
	});
	return true;
}

function useHidden(id: string) {
	return useHero((s) => s.flight?.id === id || s.pending?.id === id);
}

type HeroProps = { id: string; style?: StyleProp<ViewStyle>; children: ReactNode };

export function HeroSource({ id, style, children }: HeroProps) {
	const ref = useRef<HostInstance>(null);
	const flying = useHero((s) => s.flight?.id === id);
	useEffect(() => {
		sources.set(id, ref);
		return () => {
			if (sources.get(id) === ref) sources.delete(id);
		};
	}, [id]);
	return (
		<View ref={ref} collapsable={false} style={[style, flying ? styles.hidden : null]}>
			{children}
		</View>
	);
}

export function HeroTarget({ id, style, children }: HeroProps) {
	const ref = useRef<HostInstance>(null);
	const hidden = useHidden(id);
	useEffect(() => {
		targets.set(id, ref);
		return () => {
			if (targets.get(id) === ref) targets.delete(id);
		};
	}, [id]);
	const onLayout = async () => {
		const p = useHero.getState().pending;
		if (!p || p.id !== id) return;
		const to = await measure(ref);
		if (!to) {
			useHero.setState({ pending: null });
			return;
		}
		useHero.setState({
			pending: null,
			flight: {
				id,
				from: p.from,
				to,
				render: p.render,
				...(p.renderFrom ? { renderFrom: p.renderFrom } : {}),
				back: false,
			},
		});
	};
	return (
		<View ref={ref} collapsable={false} onLayout={onLayout} style={[style, hidden ? styles.hidden : null]}>
			{children}
		</View>
	);
}

/** Mount once at the root, after the navigator. */
export function HeroOverlay() {
	const flight = useHero((s) => s.flight);
	return flight ? <FlightView key={`${flight.id}:${flight.back}`} flight={flight} /> : null;
}

function FlightView({ flight }: { flight: Flight }) {
	const { reduced } = useMotionPolicy();
	const { from, to, back } = flight;
	// p: 0 at the small (source) rect, 1 at the destination rect.
	const p = useSharedValue(back ? 1 : 0);
	const land = () => useHero.setState({ flight: null });

	useEffect(() => {
		if (reduced) {
			land();
			return;
		}
		const cfg = back ? leave(motion.d3, curve.easeDrawer) : enter(motion.d3, curve.easeDrawer);
		p.set(
			withTiming(back ? 0 : 1, cfg, (done) => {
				if (done) runOnJS(land)();
			}),
		);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	// The big rect is the destination of the forward flight.
	const big = back ? from : to;
	const small = back ? to : from;
	// Text pairs scale by the line height alone, anchored at the start edge: glyphs never stretch, and the two
	// texts start where both titles start.
	const pair = !!flight.renderFrom;
	const rtl = I18nManager.isRTL;
	const move = useAnimatedStyle(() => {
		if (pair) {
			const s = interpolate(p.value, [0, 1], [small.height / big.height, 1]);
			const edge = rtl
				? interpolate(p.value, [0, 1], [small.x + small.width, big.x + big.width])
				: interpolate(p.value, [0, 1], [small.x, big.x]);
			const top = interpolate(p.value, [0, 1], [small.y, big.y]);
			const half = (s * big.width) / 2;
			return {
				transform: [
					{ translateX: edge - (big.x + big.width / 2) + (rtl ? -half : half) },
					{ translateY: top - (big.y + big.height / 2) + (s * big.height) / 2 },
					{ scale: s },
				],
			};
		}
		const w = interpolate(p.value, [0, 1], [small.width, big.width]);
		const h = interpolate(p.value, [0, 1], [small.height, big.height]);
		const cx = interpolate(p.value, [0, 1], [small.x + small.width / 2, big.x + big.width / 2]);
		const cy = interpolate(p.value, [0, 1], [small.y + small.height / 2, big.y + big.height / 2]);
		return {
			transform: [
				{ translateX: cx - (big.x + big.width / 2) },
				{ translateY: cy - (big.y + big.height / 2) },
				{ scaleX: w / big.width },
				{ scaleY: h / big.height },
			],
		};
	});
	// Text pairs crossfade over the first 60% of the travel (measured from the start of the flight).
	const toStyle = useAnimatedStyle(() => {
		if (!pair) return { opacity: 1 };
		const k = back ? 1 - p.value : p.value;
		const o = Math.min(1, k / 0.6);
		return { opacity: back ? 1 - o : o };
	});
	const fromStyle = useAnimatedStyle(() => {
		const k = back ? 1 - p.value : p.value;
		const o = Math.min(1, k / 0.6);
		return { opacity: back ? o : 1 - o };
	});

	return (
		<View pointerEvents="none" style={[StyleSheet.absoluteFill, { zIndex: 900 }]}>
			<Animated.View
				style={[{ position: "absolute", left: big.x, top: big.y, width: big.width, height: big.height }, move]}
			>
				{flight.renderFrom ? (
					<Animated.View style={[StyleSheet.absoluteFill, fromStyle]}>
						{flight.renderFrom({ width: big.width, height: big.height })}
					</Animated.View>
				) : null}
				<Animated.View style={[StyleSheet.absoluteFill, toStyle]}>
					{flight.render({ width: big.width, height: big.height })}
				</Animated.View>
			</Animated.View>
		</View>
	);
}

const styles = StyleSheet.create({ hidden: { opacity: 0 } });
