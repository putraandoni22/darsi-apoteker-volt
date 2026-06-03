"use client";

import { Loader2, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

export interface SuggestionOption {
	id: string;
	primary: string;
	secondary?: string;
	meta?: string;
}

interface SuggestionPanelProps {
	options: SuggestionOption[];
	isLoading?: boolean;
	emptyMessage?: string;
	highlightedIndex?: number;
	onHighlight?: (index: number) => void;
	onSelect: (option: SuggestionOption) => void;
	className?: string;
}

export function SuggestionPanel({
	options,
	isLoading = false,
	emptyMessage = "Tidak ada rekomendasi.",
	highlightedIndex = 0,
	onHighlight,
	onSelect,
	className,
}: SuggestionPanelProps) {
	if (isLoading) {
		return (
			<div
				className={cn(
					"flex items-center gap-2 rounded-lg border border-emerald-100 bg-white px-3 py-2.5 text-slate-600 text-sm shadow-sm dark:border-emerald-900/60 dark:bg-emerald-950/20 dark:text-slate-300",
					className,
				)}
			>
				<Loader2 className="h-4 w-4 shrink-0 animate-spin text-emerald-600" />
				Mencari rekomendasi...
			</div>
		);
	}

	if (options.length === 0) {
		return (
			<div
				className={cn(
					"rounded-lg border border-dashed border-emerald-100 bg-emerald-50/30 px-3 py-2 text-slate-500 text-xs dark:border-emerald-900/50 dark:bg-emerald-950/10 dark:text-slate-400",
					className,
				)}
			>
				{emptyMessage}
			</div>
		);
	}

	return (
		<div
			className={cn(
				"overflow-hidden rounded-lg border border-emerald-100 bg-white shadow-md ring-1 ring-emerald-50 dark:border-emerald-900/60 dark:bg-slate-950 dark:ring-emerald-950/50",
				className,
			)}
			role="listbox"
		>
			<div className="flex items-center gap-1.5 border-emerald-50 border-b bg-emerald-50/60 px-3 py-1.5 dark:border-emerald-900/40 dark:bg-emerald-950/30">
				<Sparkles className="h-3.5 w-3.5 text-emerald-600" />
				<span className="font-medium text-emerald-800 text-[11px] uppercase tracking-wide dark:text-emerald-200">
					Rekomendasi
				</span>
			</div>
			<ul className="max-h-44 overflow-y-auto py-0.5">
				{options.map((option, index) => (
					<li key={option.id}>
						<button
							type="button"
							role="option"
							aria-selected={highlightedIndex === index}
							onMouseDown={(event) => event.preventDefault()}
							onMouseEnter={() => onHighlight?.(index)}
							onClick={() => onSelect(option)}
							className={cn(
								"flex w-full flex-col gap-0.5 px-3 py-2 text-left transition",
								highlightedIndex === index
									? "bg-emerald-50 text-emerald-950 dark:bg-emerald-950/50 dark:text-emerald-50"
									: "text-slate-800 hover:bg-emerald-50/70 dark:text-slate-100 dark:hover:bg-emerald-950/30",
							)}
						>
							<span className="font-medium text-sm leading-tight">
								{option.primary}
							</span>
							{(option.secondary || option.meta) && (
								<span className="text-slate-500 text-xs dark:text-slate-400">
									{[option.secondary, option.meta].filter(Boolean).join(" · ")}
								</span>
							)}
						</button>
					</li>
				))}
			</ul>
		</div>
	);
}
