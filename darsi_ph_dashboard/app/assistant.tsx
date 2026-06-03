"use client";

import { useChat } from "@ai-sdk/react";
import { useRemoteThreadListRuntime } from "@assistant-ui/core/react";
import { createLocalStorageAdapter } from "@assistant-ui/core/react/adapters/LocalStorageThreadListAdapter";
import { createSimpleTitleAdapter } from "@assistant-ui/core/react/adapters/TitleGenerationAdapter";
import { AssistantRuntimeProvider } from "@assistant-ui/react";
import {
	AssistantChatTransport,
	useAISDKRuntime,
} from "@assistant-ui/react-ai-sdk";
import { useAuiState } from "@assistant-ui/store";
import Link from "next/link";
import { useEffect, useMemo } from "react";
import { Thread } from "@/components/assistant-ui/thread";
import { ThreadListSidebar } from "@/components/assistant-ui/threadlist-sidebar";
import { LogoutButton } from "@/components/auth/logout-button";
import { ThemeToggle } from "@/components/theme-toggle";
import {
	Breadcrumb,
	BreadcrumbItem,
	BreadcrumbLink,
	BreadcrumbList,
	BreadcrumbPage,
	BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
	SidebarInset,
	SidebarProvider,
	SidebarTrigger,
} from "@/components/ui/sidebar";
import type { PublicUser } from "@/lib/auth/store";

// Use relative URL so requests go through Next.js proxy (rewrites in next.config.ts)
// This makes it work regardless of whether user accesses via localhost or remote IP
const CHAT_API = "/api/chat";
const LAST_ACTIVE_THREAD_KEY = "last-active-thread";
const THREAD_SNAPSHOT_KEY_PREFIX = "thread-snapshot:";

export const Assistant = ({
	user,
	embedded = false,
}: {
	user: PublicUser | null;
	embedded?: boolean;
}) => {
	const storagePrefix = useMemo(
		() => `@darsi-apoteker:${user?.id ?? "guest"}:`,
		[user?.id],
	);

	const threadListAdapter = useMemo(() => {
		return createLocalStorageAdapter({
			storage: {
				async getItem(key) {
					if (typeof window === "undefined") {
						return null;
					}

					return window.localStorage.getItem(key);
				},
				async setItem(key, value) {
					if (typeof window === "undefined") {
						return;
					}

					window.localStorage.setItem(key, value);
				},
				async removeItem(key) {
					if (typeof window === "undefined") {
						return;
					}

					window.localStorage.removeItem(key);
				},
			},
			prefix: storagePrefix,
			titleGenerator: createSimpleTitleAdapter(),
		});
	}, [storagePrefix]);

	const runtime = useRemoteThreadListRuntime({
		adapter: threadListAdapter,
		allowNesting: true,
		runtimeHook: function RuntimeHook() {
			const id = useAuiState((s) => s.threadListItem.id);
			const transport = useMemo(
				() =>
					new AssistantChatTransport({
						api: CHAT_API,
					}),
				[],
			);

			const chat = useChat({
				id,
				transport,
			});

			const runtime = useAISDKRuntime(chat);

			if (transport instanceof AssistantChatTransport) {
				transport.setRuntime(runtime);
			}

			return runtime;
		},
	});

	useEffect(() => {
		if (typeof window === "undefined") {
			return;
		}

		const key = `${storagePrefix}${LAST_ACTIVE_THREAD_KEY}`;
		const lastActiveThreadId = window.localStorage.getItem(key);
		if (!lastActiveThreadId) {
			return;
		}

		let isRestored = false;

		const tryRestore = async () => {
			if (isRestored) {
				return;
			}

			const state = runtime.threads.getState();
			if (state.isLoading) {
				return;
			}

			const thread = state.threadItems[lastActiveThreadId];
			if (!thread || thread.status !== "regular") {
				window.localStorage.removeItem(key);
				isRestored = true;
				return;
			}

			if (state.mainThreadId === lastActiveThreadId) {
				isRestored = true;
				return;
			}

			isRestored = true;
			try {
				await runtime.threads.switchToThread(lastActiveThreadId);
			} catch (error) {
				console.warn("[assistant] Failed to restore last active thread:", error);
			}
		};

		void tryRestore();
		const unsubscribe = runtime.threads.subscribe(() => {
			void tryRestore();
		});

		return unsubscribe;
	}, [runtime, storagePrefix]);

	useEffect(() => {
		if (typeof window === "undefined") {
			return;
		}

		const lastActiveKey = `${storagePrefix}${LAST_ACTIVE_THREAD_KEY}`;
		const snapshotPrefix = `${storagePrefix}${THREAD_SNAPSHOT_KEY_PREFIX}`;
		let previousThreadIds = new Set<string>();

		const syncThreadListState = () => {
			const state = runtime.threads.getState();
			const currentThreadIds = new Set(Object.keys(state.threadItems));
			const storedLastActive = window.localStorage.getItem(lastActiveKey);
			if (storedLastActive && !currentThreadIds.has(storedLastActive)) {
				window.localStorage.removeItem(lastActiveKey);
			}

			for (const threadId of previousThreadIds) {
				if (!currentThreadIds.has(threadId)) {
					window.localStorage.removeItem(`${snapshotPrefix}${threadId}`);
				}
			}
			previousThreadIds = currentThreadIds;

			const activeThread = state.threadItems[state.mainThreadId];
			if (activeThread?.status === "regular") {
				window.localStorage.setItem(lastActiveKey, state.mainThreadId);
			}
		};

		syncThreadListState();
		const unsubscribe = runtime.threads.subscribe(syncThreadListState);

		return unsubscribe;
	}, [runtime, storagePrefix]);

	useEffect(() => {
		if (typeof window === "undefined") {
			return;
		}

		const snapshotPrefix = `${storagePrefix}${THREAD_SNAPSHOT_KEY_PREFIX}`;
		let saveTimer: ReturnType<typeof setTimeout> | null = null;
		let lastSeenMainThreadId: string | null = null;

		const restoreSnapshotForCurrentThread = () => {
			const { mainThreadId } = runtime.threads.getState();
			if (!mainThreadId || lastSeenMainThreadId === mainThreadId) {
				return;
			}

			lastSeenMainThreadId = mainThreadId;
			const snapshotRaw = window.localStorage.getItem(
				`${snapshotPrefix}${mainThreadId}`,
			);
			if (!snapshotRaw) {
				return;
			}

			const threadState = runtime.thread.getState();
			if (threadState.messages.length > 0 || threadState.isRunning) {
				return;
			}

			try {
				runtime.thread.importExternalState(JSON.parse(snapshotRaw));
			} catch (error) {
				console.warn("[assistant] Failed to restore thread snapshot:", error);
			}
		};

		const persistSnapshotForCurrentThread = () => {
			const threadListState = runtime.threads.getState();
			const { mainThreadId } = threadListState;
			if (!mainThreadId) {
				return;
			}

			const activeThread = threadListState.threadItems[mainThreadId];
			const threadState = runtime.thread.getState();
			if (
				!activeThread ||
				activeThread.status === "new" ||
				threadState.isLoading ||
				threadState.isRunning
			) {
				return;
			}

			if (saveTimer) {
				clearTimeout(saveTimer);
			}

			saveTimer = setTimeout(() => {
				saveTimer = null;

				const latestThreadId = runtime.threads.getState().mainThreadId;
				if (latestThreadId !== mainThreadId) {
					return;
				}

				const latestThreadState = runtime.thread.getState();
				if (latestThreadState.messages.length === 0) {
					return;
				}

				try {
					const externalState = runtime.thread.exportExternalState();
					window.localStorage.setItem(
						`${snapshotPrefix}${mainThreadId}`,
						JSON.stringify(externalState),
					);
				} catch (error) {
					console.warn("[assistant] Failed to persist thread snapshot:", error);
				}
			}, 150);
		};

		restoreSnapshotForCurrentThread();
		persistSnapshotForCurrentThread();

		const unsubscribeThread = runtime.thread.subscribe(() => {
			persistSnapshotForCurrentThread();
		});
		const unsubscribeThreadList = runtime.threads.subscribe(() => {
			restoreSnapshotForCurrentThread();
			persistSnapshotForCurrentThread();
		});

		return () => {
			unsubscribeThread();
			unsubscribeThreadList();
			if (saveTimer) {
				clearTimeout(saveTimer);
			}
		};
	}, [runtime, storagePrefix]);

	if (embedded) {
		return (
			<AssistantRuntimeProvider runtime={runtime}>
				<div className="flex h-full min-h-0 w-full overflow-hidden border border-border bg-background">
					<ThreadListSidebar embedded />
					<div className="flex min-w-0 flex-1 flex-col">
						<header className="flex h-14 shrink-0 items-center border-b px-4">
							<div>
								<p className="font-semibold text-sm">Asisten Obat DARSI</p>
								<p className="text-muted-foreground text-xs">
									Pencarian obat RSI, e-Fornas, dan konsultasi farmasi.
								</p>
							</div>
						</header>
						<div className="flex-1 overflow-hidden">
							<Thread maxWidth="72rem" />
						</div>
					</div>
				</div>
			</AssistantRuntimeProvider>
		);
	}

	return (
		<AssistantRuntimeProvider runtime={runtime}>
			<SidebarProvider>
				<div className="flex h-dvh w-full pr-0.5">
					<ThreadListSidebar />
					<SidebarInset>
						<header className="flex h-16 shrink-0 items-center justify-between gap-2 border-b px-4">
							<div className="flex items-center gap-2">
								<SidebarTrigger />
								<Separator orientation="vertical" className="mr-2 h-4" />
								<Breadcrumb>
									<BreadcrumbList>
										<BreadcrumbItem className="hidden md:block">
											<BreadcrumbLink href="/">DARSI Apoteker</BreadcrumbLink>
										</BreadcrumbItem>
										<BreadcrumbSeparator className="hidden md:block" />
										<BreadcrumbItem>
											<BreadcrumbPage>Pencarian Obat RSI</BreadcrumbPage>
										</BreadcrumbItem>
									</BreadcrumbList>
								</Breadcrumb>
							</div>
							<div className="flex items-center gap-2">
								{user ? (
									<>
										<div className="hidden text-right md:block">
											<p className="font-medium text-sm leading-none">
												{user.name}
											</p>
											<p className="text-muted-foreground text-xs leading-none">
												{user.email} • {user.role}
											</p>
										</div>
										<Button asChild variant="ghost" size="sm">
											<Link href="/profile">Profile</Link>
										</Button>
										{user.role === "admin" ? (
											<Button asChild variant="ghost" size="sm">
												<Link href="/settings">Settings</Link>
											</Button>
										) : null}
										<ThemeToggle />
										<LogoutButton />
									</>
								) : (
									<>
										<div className="hidden text-right md:block">
											<p className="font-medium text-sm leading-none">
												Akses cepat
											</p>
											<p className="text-muted-foreground text-xs leading-none">
												Masuk untuk fitur akun yang lebih lengkap
											</p>
										</div>
										<Button asChild variant="outline" size="sm">
											<Link href="/signin">Masuk</Link>
										</Button>
										<Button asChild size="sm">
											<Link href="/signup">Daftar</Link>
										</Button>
										<ThemeToggle />
									</>
								)}
							</div>
						</header>
						<div className="flex-1 overflow-hidden">
							<Thread />
						</div>
					</SidebarInset>
				</div>
			</SidebarProvider>
		</AssistantRuntimeProvider>
	);
};
