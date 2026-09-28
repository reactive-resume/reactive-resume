import type { PanelImperativeHandle } from "react-resizable-panels";
import { Trans } from "@lingui/react/macro";
import { ChatCircleDotsIcon, SidebarSimpleIcon, SquaresFourIcon } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useRef, useState } from "react";
import { useMediaQuery } from "usehooks-ts";
import { Button } from "@reactive-resume/ui/components/button";
import { ResizableGroup, ResizablePanel, ResizableSeparator } from "@reactive-resume/ui/components/resizable";
import { Spinner } from "@reactive-resume/ui/components/spinner";
import { Tabs, TabsList, TabsTrigger } from "@reactive-resume/ui/components/tabs";
import { cn } from "@reactive-resume/utils/style";
import { orpc } from "@/libs/orpc/client";
import { AgentChat } from "./-components/agent-chat";
import { ResumePane } from "./-components/resume-pane";
import { AgentThreadSidebar } from "./-components/thread-sidebar";
import { useAgentResumeUpdateSubscription } from "./-hooks/use-agent-resume-updates";

export const Route = createFileRoute("/agent/$threadId")({
	component: RouteComponent,
});

// Matches Tailwind's `lg` breakpoint, which this route's two layouts switch on.
// Exactly one layout may mount: each AgentChat owns its own useChat state and stream
// reconnection, so CSS-hiding a second instance would double-connect streams and expose
// stale pending approval controls after a resize.
const DESKTOP_QUERY = "(min-width: 1024px)";

function RouteComponent() {
	const { threadId } = Route.useParams();
	const navigate = useNavigate();
	const [mobileTab, setMobileTab] = useState("chat");
	const threadsPanelRef = useRef<PanelImperativeHandle | null>(null);
	const resumePanelRef = useRef<PanelImperativeHandle | null>(null);
	const [isThreadsCollapsed, setIsThreadsCollapsed] = useState(false);
	const [isResumeCollapsed, setIsResumeCollapsed] = useState(false);
	const isDesktopLayout = useMediaQuery(DESKTOP_QUERY, { initializeWithValue: false });
	const { data, isLoading, error } = useQuery(orpc.agent.threads.get.queryOptions({ input: { id: threadId } }));
	useAgentResumeUpdateSubscription({ resumeId: data?.resume?.id, threadId });

	const toggleThreadsPanel = useCallback(() => {
		const panel = threadsPanelRef.current;
		if (!panel) return;
		if (panel.isCollapsed()) {
			panel.expand();
			setIsThreadsCollapsed(false);
		} else {
			panel.collapse();
			setIsThreadsCollapsed(true);
		}
	}, []);

	const toggleResumePanel = useCallback(() => {
		const panel = resumePanelRef.current;
		if (!panel) return;
		if (panel.isCollapsed()) {
			panel.expand();
			setIsResumeCollapsed(false);
		} else {
			panel.collapse();
			setIsResumeCollapsed(true);
		}
	}, []);

	// Loading stays local to the chat/resume panes so the thread sidebar remains mounted while switching threads.
	if (!isLoading && (error || !data)) {
		return (
			<div className="grid h-svh place-items-center bg-background p-6 text-center">
				<div className="space-y-4">
					<p className="text-muted-foreground">
						<Trans>We couldn't open this thread.</Trans>
					</p>
					<Button onClick={() => void navigate({ to: "/agent/new" })}>
						<Trans>Start a new thread</Trans>
					</Button>
				</div>
			</div>
		);
	}

	const readOnlyReason: "archived" | "missing" | null = data?.isReadOnly
		? data.thread.status === "archived"
			? "archived"
			: "missing"
		: null;

	const loadingPane = (
		<div className="grid h-full place-items-center">
			<Spinner className="size-6 text-muted-foreground" />
		</div>
	);

	return (
		<div className="h-svh min-w-0 overflow-hidden bg-background">
			{isDesktopLayout ? (
				<div className="h-full">
					<ResizableGroup orientation="horizontal" className="h-full">
						<ResizablePanel
							id="threads"
							panelRef={threadsPanelRef}
							defaultSize="18%"
							minSize="240px"
							maxSize="360px"
							collapsible
							collapsedSize="0px"
							onResize={(size) => setIsThreadsCollapsed(size.inPixels < 24)}
						>
							<AgentThreadSidebar activeThreadId={threadId} className={cn(isThreadsCollapsed && "invisible")} />
						</ResizablePanel>
						<ResizableSeparator withHandle />
						<ResizablePanel id="chat" defaultSize="52%" minSize="280px">
							{data ? (
								<AgentChat
									threadId={threadId}
									initialMessages={data.messages}
									isReadOnly={data.isReadOnly}
									readOnlyReason={readOnlyReason}
									threadStatus={data.thread.status}
									reviewPatches={data.thread.reviewPatches}
									activeRunId={data.thread.activeRunId}
									actions={data.actions}
									onToggleThreads={toggleThreadsPanel}
									onToggleResume={toggleResumePanel}
								/>
							) : (
								loadingPane
							)}
						</ResizablePanel>
						<ResizableSeparator withHandle />
						<ResizablePanel
							id="resume"
							panelRef={resumePanelRef}
							defaultSize="30%"
							minSize="340px"
							maxSize="70%"
							collapsible
							collapsedSize="0px"
							onResize={(size) => setIsResumeCollapsed(size.inPixels < 24)}
						>
							<div className={cn("h-full", isResumeCollapsed && "invisible")}>
								{data && <ResumePane resume={data.resume} />}
							</div>
						</ResizablePanel>
					</ResizableGroup>
				</div>
			) : (
				<div className="flex h-full min-w-0 flex-col">
					<div className="shrink-0 border-b p-2">
						<Tabs value={mobileTab} onValueChange={setMobileTab}>
							<TabsList className="grid w-full grid-cols-3">
								<TabsTrigger value="threads">
									<SidebarSimpleIcon />
									<Trans>Threads</Trans>
								</TabsTrigger>
								<TabsTrigger value="chat">
									<ChatCircleDotsIcon />
									<Trans>Chat</Trans>
								</TabsTrigger>
								<TabsTrigger value="resume">
									<SquaresFourIcon />
									<Trans>Resume</Trans>
								</TabsTrigger>
							</TabsList>
						</Tabs>
					</div>
					<div className="min-h-0 min-w-0 flex-1 overflow-hidden">
						<div className={cn("h-full min-w-0", mobileTab !== "threads" && "hidden")}>
							<AgentThreadSidebar activeThreadId={threadId} className="border-e-0" />
						</div>
						<div className={cn("h-full min-w-0", mobileTab !== "chat" && "hidden")}>
							{data ? (
								<AgentChat
									threadId={threadId}
									initialMessages={data.messages}
									isReadOnly={data.isReadOnly}
									readOnlyReason={readOnlyReason}
									threadStatus={data.thread.status}
									reviewPatches={data.thread.reviewPatches}
									activeRunId={data.thread.activeRunId}
									actions={data.actions}
								/>
							) : (
								loadingPane
							)}
						</div>
						<div className={cn("h-full min-w-0", mobileTab !== "resume" && "hidden")}>
							{data && <ResumePane resume={data.resume} />}
						</div>
					</div>
				</div>
			)}
		</div>
	);
}
