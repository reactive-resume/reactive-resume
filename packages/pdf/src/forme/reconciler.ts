import type { ReactNode } from "react";
import Reconciler from "react-reconciler";
import { ConcurrentRoot, DefaultEventPriority } from "react-reconciler/constants.js";

/** An element the templates rendered: one of the host primitives in `primitives.tsx`, with its resolved props. */
export type HostElement = { type: string; props: Record<string, unknown>; children: HostNode[] };
type HostText = { type: "#text"; text: string };
export type HostNode = HostElement | HostText;

type Container = { children: HostNode[] };

const append = (parent: { children: HostNode[] }, child: HostNode) => {
	parent.children.push(child);
};

const insertBefore = (parent: { children: HostNode[] }, child: HostNode, before: HostNode) => {
	const index = parent.children.indexOf(before);
	parent.children.splice(index < 0 ? parent.children.length : index, 0, child);
};

const remove = (parent: { children: HostNode[] }, child: HostNode) => {
	const index = parent.children.indexOf(child);
	if (index >= 0) parent.children.splice(index, 1);
};

const withoutChildren = (props: Record<string, unknown>) => {
	const { children: _children, ...rest } = props;
	return rest;
};

let currentPriority: number = DefaultEventPriority;

/**
 * A minimal React renderer: it runs the templates with real hooks and context and records the host elements they
 * produce. Forme's own serializer calls components as plain functions, which hooks and context can't survive.
 */
const reconciler = Reconciler({
	supportsMutation: true,
	supportsPersistence: false,
	supportsHydration: false,
	isPrimaryRenderer: false,
	noTimeout: -1,
	createInstance: (type: string, props: Record<string, unknown>): HostElement => ({
		type,
		props: withoutChildren(props),
		children: [],
	}),
	createTextInstance: (text: string): HostText => ({ type: "#text", text }),
	appendInitialChild: append,
	appendChild: append,
	appendChildToContainer: append,
	insertBefore,
	insertInContainerBefore: insertBefore,
	removeChild: remove,
	removeChildFromContainer: remove,
	commitUpdate: (
		instance: HostElement,
		_type: string,
		_old: Record<string, unknown>,
		next: Record<string, unknown>,
	) => {
		instance.props = withoutChildren(next);
	},
	commitTextUpdate: (instance: HostText, _old: string, next: string) => {
		instance.text = next;
	},
	finalizeInitialChildren: () => false,
	shouldSetTextContent: () => false,
	getPublicInstance: (instance: HostNode) => instance,
	getRootHostContext: () => ({}),
	getChildHostContext: (parent: object) => parent,
	prepareForCommit: () => null,
	resetAfterCommit: () => {},
	clearContainer: (container: Container) => {
		container.children = [];
	},
	resetTextContent: () => {},
	hideInstance: () => {},
	unhideInstance: () => {},
	hideTextInstance: () => {},
	unhideTextInstance: () => {},
	detachDeletedInstance: () => {},
	preparePortalMount: () => {},
	scheduleTimeout: setTimeout,
	cancelTimeout: clearTimeout,
	getCurrentUpdatePriority: () => currentPriority,
	setCurrentUpdatePriority: (priority: number) => {
		currentPriority = priority;
	},
	resolveUpdatePriority: () => currentPriority,
	getInstanceFromNode: () => null,
	beforeActiveInstanceBlur: () => {},
	afterActiveInstanceBlur: () => {},
	prepareScopeUpdate: () => {},
	getInstanceFromScope: () => null,
	maySuspendCommit: () => false,
	preloadInstance: () => true,
	startSuspendingCommit: () => {},
	suspendInstance: () => {},
	waitForCommitToBeReady: () => null,
	requestPostPaintCallback: () => {},
	shouldAttemptEagerTransition: () => false,
	trackSchedulerEvent: () => {},
	resolveEventType: () => null,
	resolveEventTimeStamp: () => -1.1,
	NotPendingTransition: null,
	HostTransitionContext: {
		$$typeof: Symbol.for("react.context"),
		_currentValue: null,
		_currentValue2: null,
	},
	resetFormInstance: () => {},
	// oxlint-disable-next-line typescript/no-explicit-any -- the host config typings trail react-reconciler 0.34.
} as any);

/** Renders `element` synchronously and returns the host tree it produced. Errors thrown while rendering rethrow. */
export function renderHostTree(element: ReactNode): HostNode[] {
	const container: Container = { children: [] };
	const errors: unknown[] = [];
	const onError = (error: unknown) => {
		errors.push(error);
	};
	// oxlint-disable-next-line typescript/no-explicit-any -- createContainer's arity changes across 0.3x releases.
	const create = reconciler.createContainer as (...args: any[]) => unknown;
	const root = create(container, ConcurrentRoot, null, false, null, "", onError, onError, onError, () => {}, null);
	// oxlint-disable-next-line typescript/no-explicit-any -- `updateContainerSync` and `flushSyncWork` exist from 0.31.
	const sync = reconciler as any;
	sync.updateContainerSync(element, root, null, null);
	sync.flushSyncWork();
	// Unmount so the fibers can be collected; the recorded tree stays in `container`.
	// Unmounting detaches the top-level nodes from the container array, so keep a copy of it.
	const tree = [...container.children];
	sync.updateContainerSync(null, root, null, null);
	sync.flushSyncWork();
	if (errors.length > 0) throw errors[0];
	return tree;
}
