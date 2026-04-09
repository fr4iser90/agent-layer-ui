<script lang="ts">
	import { browser } from '$app/environment';
	import { getContext, onMount } from 'svelte';
	import type { Writable } from 'svelte/store';
	import type { i18n as i18nType } from 'i18next';
	import type { AgentLayerTimelineEntry } from '$lib/utils/agentLayerTimeline';
	import {
		classifyAgentTimelineType,
		countTimelineStats,
		linearizeSegmentForDisplay,
		segmentAgentTimelineByRound,
		summarizeAgentLayerTimelineEntry
	} from '$lib/utils/agentLayerTimeline';

	const i18n = getContext<Writable<i18nType>>('i18n');

	const STORAGE_KEY = 'agent-layer-timeline-mode';

	export let entries: AgentLayerTimelineEntry[] = [];

	let mode: 'simple' | 'detailed' = 'simple';

	onMount(() => {
		if (browser) {
			const v = localStorage.getItem(STORAGE_KEY);
			if (v === 'detailed' || v === 'simple') mode = v;
		}
	});

	function setMode(m: 'simple' | 'detailed') {
		mode = m;
		if (browser) localStorage.setItem(STORAGE_KEY, m);
	}

	$: segments = segmentAgentTimelineByRound(entries);
	$: stats = countTimelineStats(entries);

	function badgeClass(kind: ReturnType<typeof classifyAgentTimelineType>): string {
		switch (kind) {
			case 'session':
				return 'bg-gray-200/90 text-gray-800 dark:bg-gray-700 dark:text-gray-100';
			case 'thinking':
				return 'bg-violet-200/90 text-violet-900 dark:bg-violet-900/60 dark:text-violet-100';
			case 'tool':
				return 'bg-blue-200/90 text-blue-900 dark:bg-blue-900/50 dark:text-blue-100';
			case 'tool_done':
				return 'bg-emerald-200/90 text-emerald-900 dark:bg-emerald-900/50 dark:text-emerald-100';
			case 'wait':
				return 'bg-amber-200/90 text-amber-900 dark:bg-amber-900/50 dark:text-amber-100';
			case 'done':
				return 'bg-teal-200/90 text-teal-900 dark:bg-teal-900/50 dark:text-teal-100';
			default:
				return 'bg-zinc-200/80 text-zinc-800 dark:bg-zinc-700 dark:text-zinc-100';
		}
	}

	function badgeLabel(kind: ReturnType<typeof classifyAgentTimelineType>): string {
		switch (kind) {
			case 'session':
				return $i18n.t('SESSION');
			case 'thinking':
				return $i18n.t('THINK');
			case 'tool':
				return $i18n.t('TOOL');
			case 'tool_done':
				return $i18n.t('RESULT');
			case 'wait':
				return $i18n.t('WAITING');
			case 'done':
				return $i18n.t('DONE');
			default:
				return $i18n.t('STEP');
		}
	}
</script>

{#if entries.length > 0}
	<div
		class="mt-2 rounded-xl border border-gray-200/90 dark:border-gray-700/80 bg-gray-50/50 dark:bg-gray-900/25 text-xs max-w-full overflow-hidden"
	>
		<div
			class="flex flex-wrap items-center justify-between gap-2 px-2.5 py-1.5 border-b border-gray-200/70 dark:border-gray-700/60"
		>
			<div class="font-medium text-gray-800 dark:text-gray-200">
				{$i18n.t('Execution log')}
				<span class="text-gray-500 dark:text-gray-400 font-normal">
					· {stats.frames} {$i18n.t('events')}
					· {stats.segments}
					{stats.segments === 1 ? $i18n.t('block') : $i18n.t('blocks')}
					· {stats.toolPairs} {$i18n.t('tool runs')}
				</span>
			</div>
			<div class="flex rounded-lg border border-gray-200 dark:border-gray-600 overflow-hidden text-[0.65rem]">
				<button
					type="button"
					class="px-2 py-0.5 font-medium transition {mode === 'simple'
						? 'bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900'
						: 'bg-transparent text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'}"
					on:click={() => setMode('simple')}
				>
					{$i18n.t('Simple')}
				</button>
				<button
					type="button"
					class="px-2 py-0.5 font-medium transition {mode === 'detailed'
						? 'bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900'
						: 'bg-transparent text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'}"
					on:click={() => setMode('detailed')}
				>
					{$i18n.t('Detailed')}
				</button>
			</div>
		</div>

		<div class="p-2 space-y-2 max-h-[min(24rem,55vh)] overflow-y-auto scrollbar-hidden">
			{#each segments as segment, segIdx (segIdx)}
				<details
					class="rounded-lg border border-gray-200/80 dark:border-gray-700/50 bg-white/40 dark:bg-gray-950/30"
					open={mode === 'detailed'}
				>
					<summary
						class="cursor-pointer select-none list-none px-2 py-1.5 font-medium text-gray-700 dark:text-gray-300 flex items-center gap-2 [&::-webkit-details-marker]:hidden"
					>
						<span class="text-[0.7rem] uppercase tracking-wide text-gray-500 dark:text-gray-400">
							{segments.length > 1
								? $i18n.t('Block {{n}}', { n: segIdx + 1 })
								: $i18n.t('Run')}
						</span>
						<span class="text-gray-400 dark:text-gray-500 font-normal text-[0.65rem]">
							({segment.length} {$i18n.t('events')})
						</span>
					</summary>
					<div class="px-2 pb-2 space-y-2 border-t border-gray-100 dark:border-gray-800/80 pt-2">
						{#each linearizeSegmentForDisplay(segment) as row, ri (`${segIdx}-${ri}`)}
							{#if row.kind === 'tool_pair'}
								<div
									class="rounded-md border border-blue-200/80 dark:border-blue-900/50 bg-blue-50/40 dark:bg-blue-950/20 pl-2 py-1.5"
								>
									<div class="flex flex-wrap items-center gap-1.5 mb-0.5">
										<span
											class="inline-flex items-center px-1.5 py-0 rounded text-[0.6rem] font-semibold tracking-wide {badgeClass(
												'tool'
											)}"
										>
											{badgeLabel('tool')}
										</span>
										<span class="font-mono text-[0.7rem] font-medium text-gray-800 dark:text-gray-200">
											{row.name}
										</span>
									</div>
									{#if row.start}
										{@const s = summarizeAgentLayerTimelineEntry(row.start)}
										{#if s}
											<div class="text-[0.65rem] text-gray-600 dark:text-gray-400 pl-1 border-l-2 border-blue-300/80 dark:border-blue-800">
												{s}
											</div>
										{/if}
									{/if}
									{#if row.done}
										{@const d = summarizeAgentLayerTimelineEntry(row.done)}
										<div
											class="text-[0.65rem] text-emerald-800 dark:text-emerald-200/90 pl-1 mt-0.5 border-l-2 border-emerald-400/70 dark:border-emerald-800"
										>
											<span class="font-medium">{$i18n.t('RESULT')}:</span>
											{d || '—'}
										</div>
									{/if}
								</div>
							{:else}
								{@const e = row.entry}
								{@const k = classifyAgentTimelineType(e.type)}
								<div
									class="rounded-md border border-gray-200/70 dark:border-gray-700/50 pl-2 py-1 {k === 'thinking'
										? 'bg-violet-50/50 dark:bg-violet-950/10'
										: k === 'wait'
											? 'bg-amber-50/50 dark:bg-amber-950/15'
											: ''}"
								>
									<div class="flex flex-wrap items-center gap-1.5 mb-0.5">
										<span
											class="inline-flex items-center px-1.5 py-0 rounded text-[0.6rem] font-semibold tracking-wide {badgeClass(
												k
											)}"
										>
											{badgeLabel(k)}
										</span>
										<span class="font-mono text-[0.6rem] text-gray-500 dark:text-gray-400">{e.type}</span>
									</div>
									{#if summarizeAgentLayerTimelineEntry(e)}
										<div class="text-[0.65rem] text-gray-700 dark:text-gray-300 leading-snug break-words">
											{summarizeAgentLayerTimelineEntry(e)}
										</div>
									{/if}
								</div>
							{/if}
						{/each}
					</div>
				</details>
			{/each}
		</div>

		{#if mode === 'simple'}
			<p class="px-2.5 pb-2 text-[0.65rem] text-gray-500 dark:text-gray-400">
				{$i18n.t('Switch to Detailed to see every frame and raw event types.')}
			</p>
		{/if}
	</div>
{/if}
