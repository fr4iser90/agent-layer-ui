<script lang="ts">
	import { getContext, onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import type { Writable } from 'svelte/store';
	import type { i18n as i18nType } from 'i18next';

	import Chat from '$lib/components/chat/Chat.svelte';
	import Help from '$lib/components/layout/Help.svelte';

	import { get } from 'svelte/store';
	import { models, settings, type Model } from '$lib/stores';
	import { getAgentLayerUpstream } from '$lib/utils/agentLayerConnection';
	import { fetchAgentLayerModelsForPicker } from '$lib/utils/agentLayerModels';

	const i18n = getContext<Writable<i18nType>>('i18n');

	/** Empty = new chat; UUID = existing agent chat (`/agent/chat/[id]`). */
	export let chatIdProp = '';

	const agentPathWithQuery = (searchParams: URLSearchParams) =>
		`${get(page).url.pathname}?${searchParams.toString()}`;

	let remoteAgentPickerModels: Model[] = [];

	$: stepModeOn = $page.url.searchParams.get('agent_step_mode') === '1';

	const syncStepModeToUrl = async (on: boolean) => {
		const searchParams = new URLSearchParams(get(page).url.searchParams);
		if (on) {
			searchParams.set('agent_step_mode', '1');
		} else {
			searchParams.delete('agent_step_mode');
		}
		await goto(agentPathWithQuery(searchParams), { replaceState: true, noScroll: true });
	};

	$: workspaceAgentModels = $models.filter(
		(m) => (m as any)?.info?.meta?.capabilities?.['agent-layer']
	);

	$: agentLayerPickerModels =
		workspaceAgentModels.length > 0 ? workspaceAgentModels : remoteAgentPickerModels;

	const refreshRemoteAgentModels = async () => {
		const up = getAgentLayerUpstream(get(settings));
		if (!up) {
			remoteAgentPickerModels = [];
			return;
		}
		remoteAgentPickerModels = await fetchAgentLayerModelsForPicker(up.baseUrl, up.token);
	};

	const getAgentModelIds = () => {
		const ws = get(models)
			.filter((m) => (m as any)?.info?.meta?.capabilities?.['agent-layer'])
			.map((m) => m.id);
		if (ws.length > 0) return ws;
		return remoteAgentPickerModels.map((m) => m.id);
	};

	type AgentToolListResponse = { tools?: any[]; tools_meta?: any[] };
	type AgentRouterCategoriesResponse = { categories?: Array<{ id: string; name?: string }> };

	let toolsLoading = false;
	let toolsError: string | null = null;
	let agentTools: any[] = [];
	let agentToolMeta: any[] = [];

	let categoriesLoading = false;
	let categoriesError: string | null = null;
	let agentCategories: Array<{ id: string; name?: string }> = [];

	let enabledCategoryIds: string[] = [];

	let showAgentPanel = false;

	const syncEnabledCategoriesToUrl = async (categoryIds: string[]) => {
		const searchParams = new URLSearchParams(get(page).url.searchParams);

		if (categoryIds.length > 0) {
			searchParams.set('agent_categories', categoryIds.join(','));
		} else {
			searchParams.delete('agent_categories');
		}

		await goto(agentPathWithQuery(searchParams), { replaceState: true, noScroll: true });
	};

	const initEnabledCategoriesFromUrl = () => {
		const url = get(page).url;
		const raw = url.searchParams.get('agent_categories') ?? '';
		enabledCategoryIds = raw
			.split(',')
			.map((s) => s.trim())
			.filter((s) => s);
	};

	/** Only Agent Layer base URL — never Ollama or Direct Connections. */
	const getAgentConnection = () => {
		const up = getAgentLayerUpstream(get(settings) ?? {});
		if (!up) {
			return { url: null as string | null, key: '' };
		}
		return { url: up.baseUrl, key: up.token ?? '' };
	};

	const authHeaders = () => {
		const { key } = getAgentConnection();
		return {
			Accept: 'application/json',
			...(key ? { Authorization: `Bearer ${key}` } : {})
		};
	};

	const loadAgentTools = async () => {
		const { url } = getAgentConnection();
		if (!url) return;

		toolsLoading = true;
		toolsError = null;
		try {
			const res = await fetch(`${url}/v1/tools`, { headers: authHeaders() });
			if (!res.ok) {
				throw new Error(`Failed to load tools (${res.status})`);
			}
			const json = (await res.json()) as AgentToolListResponse;
			agentTools = json.tools ?? [];
			agentToolMeta = json.tools_meta ?? [];
		} catch (e: any) {
			toolsError = e?.message ?? String(e);
			agentTools = [];
			agentToolMeta = [];
		} finally {
			toolsLoading = false;
		}
	};

	const loadAgentCategories = async () => {
		const { url } = getAgentConnection();
		if (!url) return;

		categoriesLoading = true;
		categoriesError = null;
		try {
			const res = await fetch(`${url}/v1/router/categories`, { headers: authHeaders() });
			if (!res.ok) {
				throw new Error(`Failed to load categories (${res.status})`);
			}
			const json = (await res.json()) as AgentRouterCategoriesResponse;
			agentCategories = json.categories ?? [];
		} catch (e: any) {
			categoriesError = e?.message ?? String(e);
			agentCategories = [];
		} finally {
			categoriesLoading = false;
		}
	};

	const ensureDefaultAgentModels = async () => {
		const url = get(page).url;
		if (url.searchParams.get('models') || url.searchParams.get('model')) return;

		const agentModels = getAgentModelIds();

		if (agentModels.length === 0) return;

		const searchParams = new URLSearchParams(url.searchParams);
		searchParams.set('models', agentModels.join(','));
		await goto(agentPathWithQuery(searchParams), { replaceState: true, noScroll: true });
	};

	const useAgentModelsNow = async () => {
		const url = get(page).url;
		const agentModels = getAgentModelIds();
		if (agentModels.length === 0) return;

		const searchParams = new URLSearchParams(url.searchParams);
		searchParams.set('models', agentModels.join(','));
		searchParams.delete('model');
		await goto(agentPathWithQuery(searchParams), { replaceState: true, noScroll: true });
	};

	onMount(async () => {
		initEnabledCategoriesFromUrl();
		await refreshRemoteAgentModels();
		await ensureDefaultAgentModels();
		await Promise.all([loadAgentTools(), loadAgentCategories()]);

		const unsub = settings.subscribe(() => {
			refreshRemoteAgentModels().then(async () => {
				await Promise.all([loadAgentTools(), loadAgentCategories()]);
			});
		});
		return () => unsub();
	});
</script>

<Help />
<div class="flex flex-col flex-1 min-h-0 w-full overflow-hidden gap-1.5">
	<div class="flex-none min-w-0">
		<div
			class="flex flex-nowrap items-center justify-between gap-2 overflow-x-auto pb-0.5 scrollbar-none touch-pan-x"
		>
			<div class="flex items-center gap-2 shrink-0">
				<div class="text-sm font-semibold">Agent</div>
				<div class="text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">
					{getAgentModelIds().length} agent model(s) available
				</div>
				<button
					class="text-xs px-2 py-1 rounded-full bg-gray-50 hover:bg-gray-100 dark:bg-gray-900 dark:hover:bg-gray-850 transition font-medium shrink-0"
					type="button"
					on:click={() => {
						showAgentPanel = !showAgentPanel;
					}}
				>
					Tools: {agentTools.length}
				</button>
			</div>

			<div class="flex items-center gap-2 sm:gap-3 shrink-0">
				<label
					class="flex items-center gap-1.5 text-xs text-gray-600 dark:text-gray-400 cursor-pointer select-none whitespace-nowrap"
				>
					<input
						type="checkbox"
						class="rounded border-gray-300 dark:border-gray-600 shrink-0"
						checked={stepModeOn}
						on:change={(e) => syncStepModeToUrl(e.currentTarget.checked)}
					/>
					<span class="hidden sm:inline">{$i18n.t('Pause between tool rounds (WebSocket)')}</span>
					<span class="sm:hidden">{$i18n.t('STEP')}</span>
				</label>
				<button
					class="text-xs px-3 py-1.5 rounded-full bg-gray-50 hover:bg-gray-100 dark:bg-gray-900 dark:hover:bg-gray-850 transition font-medium whitespace-nowrap"
					type="button"
					on:click={useAgentModelsNow}
					disabled={getAgentModelIds().length === 0}
				>
					Use agent models
				</button>
			</div>
		</div>
	</div>

	{#if showAgentPanel}
		<div
			class="flex-none min-h-0 max-h-[min(40vh,22rem)] overflow-y-auto overscroll-contain rounded-xl border border-gray-100 dark:border-gray-850 bg-white/50 dark:bg-gray-950/50 p-3"
		>
			<div class="flex flex-wrap items-center justify-between gap-2">
				<div class="text-sm font-semibold">Agent Tools & Categories</div>
				<div class="flex gap-2">
					<button
						class="text-xs px-2.5 py-1 rounded-full bg-gray-50 hover:bg-gray-100 dark:bg-gray-900 dark:hover:bg-gray-850 transition font-medium"
						type="button"
						on:click={() => Promise.all([loadAgentTools(), loadAgentCategories()])}
					>
						Refresh
					</button>
				</div>
			</div>

			<div class="mt-2 grid gap-3 md:grid-cols-2">
				<div>
					<div class="text-xs font-semibold text-gray-600 dark:text-gray-300">Categories</div>
					{#if categoriesLoading}
						<div class="mt-1 text-xs text-gray-500 dark:text-gray-400">Loading…</div>
					{:else if categoriesError}
						<div class="mt-1 text-xs text-red-600 dark:text-red-400">{categoriesError}</div>
					{:else if agentCategories.length === 0}
						<div class="mt-1 text-xs text-gray-500 dark:text-gray-400">No categories found.</div>
					{:else}
						<div class="mt-2 flex flex-wrap gap-1.5">
							{#each agentCategories as cat (cat.id)}
								<button
									class="text-xs px-2.5 py-1 rounded-full border transition font-medium {enabledCategoryIds.includes(cat.id)
										? 'bg-black text-white dark:bg-white dark:text-black border-transparent'
										: 'bg-transparent border-gray-200 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-900'}"
									type="button"
									on:click={() => {
										if (enabledCategoryIds.includes(cat.id)) {
											enabledCategoryIds = enabledCategoryIds.filter((id) => id !== cat.id);
										} else {
											enabledCategoryIds = [...enabledCategoryIds, cat.id];
										}
										syncEnabledCategoriesToUrl(enabledCategoryIds);
									}}
									title={cat.id}
								>
									{cat.name ?? cat.id}
								</button>
							{/each}
						</div>
						<div class="mt-2 text-xs text-gray-500 dark:text-gray-400">
							Enabled: {enabledCategoryIds.join(', ') || '—'}
						</div>
						{#if enabledCategoryIds.length > 0}
							<div class="mt-1 text-xs font-mono text-gray-500 dark:text-gray-400">
								X-Agent-Router-Categories: {enabledCategoryIds.join(',')}
							</div>
						{/if}
					{/if}
				</div>

				<div>
					<div class="text-xs font-semibold text-gray-600 dark:text-gray-300">Tools</div>
					{#if toolsLoading}
						<div class="mt-1 text-xs text-gray-500 dark:text-gray-400">Loading…</div>
					{:else if toolsError}
						<div class="mt-1 text-xs text-red-600 dark:text-red-400">{toolsError}</div>
					{:else if agentTools.length === 0}
						<div class="mt-1 text-xs text-gray-500 dark:text-gray-400">No tools found.</div>
					{:else}
						<div class="mt-2 max-h-32 sm:max-h-36 overflow-auto scrollbar-hidden rounded-lg border border-gray-100 dark:border-gray-850">
							{#each agentTools as tool, idx (idx)}
								<div class="px-2.5 py-1.5 text-xs border-b border-gray-50 dark:border-gray-900 last:border-b-0">
									<div class="font-medium">{tool?.function?.name ?? tool?.name ?? 'tool'}</div>
									{#if tool?.function?.description}
										<div class="text-gray-500 dark:text-gray-400 line-clamp-2">
											{tool.function.description}
										</div>
									{/if}
								</div>
							{/each}
						</div>
					{/if}
				</div>
			</div>
		</div>
	{/if}

	<div class="flex-1 min-h-0 flex flex-col overflow-hidden">
		<Chat fillContainer modelPickerModels={agentLayerPickerModels} {chatIdProp} />
	</div>
</div>
