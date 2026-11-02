import type { ComponentProps } from "react";
import { MessageScroller as MessageScrollerPrimitive, useMessageScroller } from "@shadcn/react/message-scroller";
import { Button } from "@reactive-resume/ui/components/button";
import { cn } from "@reactive-resume/utils/style";

/**
 * shadcn Message Scroller (behaviour from `@shadcn/react`): a chat transcript that follows a streaming reply only while
 * the reader is at the live edge, settles each new turn near the top, reopens a saved thread on its last turn, and
 * offers a way back to the latest message. Wrap every direct child of the content in `MessageScrollerItem`.
 */
const MessageScrollerProvider = MessageScrollerPrimitive.Provider;

/** The frame: fills its parent, so put it in a height-constrained container. */
function MessageScroller({ className, ...props }: ComponentProps<typeof MessageScrollerPrimitive.Root>) {
	return (
		<MessageScrollerPrimitive.Root
			data-slot="message-scroller"
			className={cn("group/message-scroller relative flex size-full min-h-0 flex-col overflow-hidden", className)}
			{...props}
		/>
	);
}

/** The scrolling region; it stays hidden until a saved thread has opened at its starting position. */
function MessageScrollerViewport({ className, ...props }: ComponentProps<typeof MessageScrollerPrimitive.Viewport>) {
	return (
		<MessageScrollerPrimitive.Viewport
			data-slot="message-scroller-viewport"
			className={cn(
				"size-full min-h-0 min-w-0 scroll-fade-b [scrollbar-width:thin] [scrollbar-gutter:stable] overflow-y-auto overscroll-contain focus-visible:outline-offset-[-2px] data-pending-scroll:invisible",
				className,
			)}
			{...props}
		/>
	);
}

/** The transcript (`role="log"`): new rows are announced, streamed text is not read out token by token. */
function MessageScrollerContent({ className, ...props }: ComponentProps<typeof MessageScrollerPrimitive.Content>) {
	return (
		<MessageScrollerPrimitive.Content
			data-slot="message-scroller-content"
			className={cn("flex h-max min-h-full flex-col", className)}
			{...props}
		/>
	);
}

/** One transcript row. `scrollAnchor` marks a row that starts a turn (the person's message). */
function MessageScrollerItem({ className, ...props }: ComponentProps<typeof MessageScrollerPrimitive.Item>) {
	return (
		<MessageScrollerPrimitive.Item
			data-slot="message-scroller-item"
			className={cn("min-w-0 shrink-0 [contain-intrinsic-size:auto_10rem] [content-visibility:auto]", className)}
			{...props}
		/>
	);
}

type MessageScrollerButtonProps = ComponentProps<typeof MessageScrollerPrimitive.Button>;

/**
 * "Latest": appears while there is newer content below and returns the reader to the live edge, which resumes
 * following. Inert, and out of the tab order, while there is nothing to scroll to. Pass a translated label as children.
 */
function MessageScrollerButton({ className, direction = "end", render, ...props }: MessageScrollerButtonProps) {
	return (
		<MessageScrollerPrimitive.Button
			data-slot="message-scroller-button"
			data-direction={direction}
			direction={direction}
			className={cn(
				"absolute inset-s-1/2 -translate-x-1/2 bg-raised transition-[translate,opacity] duration-standard ease-enter data-[active=false]:pointer-events-none data-[active=false]:opacity-0 data-[active=true]:translate-y-0 data-[active=true]:opacity-100 data-[direction=end]:bottom-3 data-[direction=end]:data-[active=false]:translate-y-2 data-[direction=start]:top-3 data-[direction=start]:data-[active=false]:-translate-y-2 rtl:translate-x-1/2",
				className,
			)}
			render={render ?? <Button variant="secondary" size="sm" />}
			{...props}
		/>
	);
}

export {
	MessageScroller,
	MessageScrollerButton,
	MessageScrollerContent,
	MessageScrollerItem,
	MessageScrollerProvider,
	MessageScrollerViewport,
	useMessageScroller,
};
