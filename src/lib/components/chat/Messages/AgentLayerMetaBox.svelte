<script lang="ts">
	import { getContext } from 'svelte';
	import type { Writable } from 'svelte/store';
	import type { i18n as i18nType } from 'i18next';
	import type { AgentLayerCompletionMeta } from '$lib/utils/agentLayerMeta';

	const i18n = getContext<Writable<i18nType>>('i18n');

	export let meta: AgentLayerCompletionMeta;

	$: count =
		meta.forwarded_tool_count ??
		(meta.forwarded_tools?.length !== undefined ? meta.forwarded_tools.length : undefined);
	$: cats =
		meta.router_categories?.length ? meta.router_categories.join(', ') : '';
</script>

<details
	class="mt-2 rounded-lg border border-gray-200/80 dark:border-gray-700/80 bg-gray-50/80 dark:bg-gray-900/40 text-xs text-gray-700 dark:text-gray-300 max-w-full"
>
	<summary
		class="cursor-pointer select-none list-none px-2.5 py-1.5 font-medium flex flex-wrap items-center gap-1.5 [&::-webkit-details-marker]:hidden"
	>
		<span class="text-[0.65rem] uppercase tracking-wide text-gray-500 dark:text-gray-400 shrink-0">
			{$i18n.t('Agent Layer')}
		</span>
		{#if meta.routed_category}
			<span
				class="px-1.5 py-0.5 rounded-md bg-white/90 dark:bg-gray-800/90 border border-gray-200/80 dark:border-gray-600/50 font-mono text-[0.7rem]"
				title={$i18n.t('Router category')}
			>
				{meta.routed_category}
			</span>
		{/if}
		{#if count !== undefined}
			<span class="text-gray-500 dark:text-gray-400">
				· {count}
				{$i18n.t('tools forwarded')}
			</span>
		{/if}
	</summary>
	<div class="px-2.5 pb-2 pt-0 space-y-1.5 border-t border-gray-200/60 dark:border-gray-700/50">
		{#if cats}
			<div>
				<span class="text-gray-500 dark:text-gray-400">{$i18n.t('Router categories')}:</span>
				<span class="ml-1 font-mono text-[0.7rem] break-all">{cats}</span>
			</div>
		{/if}
		{#if meta.forwarded_tools && meta.forwarded_tools.length > 0}
			<div>
				<div class="text-gray-500 dark:text-gray-400 mb-0.5">{$i18n.t('Forwarded tool names')}</div>
				<div
					class="font-mono text-[0.65rem] leading-relaxed max-h-24 overflow-y-auto scrollbar-hidden text-gray-600 dark:text-gray-400"
				>
					{meta.forwarded_tools.join(', ')}
				</div>
			</div>
		{/if}
	</div>
</details>
