<script lang="ts">
	import { getContext } from 'svelte';
	const i18n = getContext('i18n');

	import Modal from '$lib/components/common/Modal.svelte';
	import { normalizeAgentLayerV1Url } from '$lib/apis/openai';

	export let show = false;
	export let url = '';
	export let token = '';

	let modelsLoading = false;
	let modelsError: string | null = null;
	let modelCount: number | null = null;
	let healthOk: boolean | null = null;

	const base = () => (url ?? '').trim().replace(/\/$/, '');

	const refresh = async () => {
		modelsLoading = true;
		modelsError = null;
		modelCount = null;
		healthOk = null;
		const b = base();
		if (!b) {
			modelsLoading = false;
			return;
		}
		try {
			const h = await fetch(`${b}/health`, { headers: { Accept: 'application/json' } });
			healthOk = h.ok;
		} catch {
			healthOk = false;
		}
		try {
			const v1 = normalizeAgentLayerV1Url(b);
			const headers: Record<string, string> = { Accept: 'application/json' };
			if (token) headers.Authorization = `Bearer ${token}`;
			const m = await fetch(`${v1}/models`, { headers });
			if (!m.ok) throw new Error(`HTTP ${m.status}`);
			const json = await m.json();
			const data = Array.isArray(json?.data)
				? json.data
				: Array.isArray(json?.models)
					? json.models
					: [];
			modelCount = data.length;
		} catch (e: any) {
			modelsError = e?.message ?? String(e);
		} finally {
			modelsLoading = false;
		}
	};

	$: if (show && url) {
		refresh();
	}
</script>

<Modal size="sm" bind:show>
	<div>
		<div class=" flex justify-between dark:text-gray-100 px-5 pt-4 pb-2">
			<div
				class="flex w-full justify-between items-center text-lg font-medium self-center font-primary"
			>
				<div class=" shrink-0">
					{$i18n.t('Manage Agent Layer')}
				</div>
			</div>
			<button
				class="self-center"
				on:click={() => {
					show = false;
				}}
			>
				<svg
					xmlns="http://www.w3.org/2000/svg"
					viewBox="0 0 20 20"
					fill="currentColor"
					class="w-5 h-5"
				>
					<path
						d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z"
					/>
				</svg>
			</button>
		</div>

		<div class="flex flex-col w-full px-5 pb-4 space-y-3 text-sm dark:text-gray-200">
			<div class="text-xs text-gray-500 dark:text-gray-400">
				{$i18n.t('WebUI will make requests to "{{url}}/v1/chat/completions"', {
					url: base() || '—'
				})}
			</div>

			<div class="flex flex-wrap items-center gap-2">
				<button
					type="button"
					class="text-xs px-2.5 py-1 rounded-full bg-gray-100 hover:bg-gray-200 dark:bg-gray-850 dark:hover:bg-gray-800 transition font-medium"
					on:click={refresh}
				>
					{$i18n.t('Refresh')}
				</button>
			</div>

			{#if modelsLoading}
				<div class="text-xs text-gray-500">{$i18n.t('Loading...')}</div>
			{:else}
				<div class="text-xs">
					<span class="font-medium">{$i18n.t('Health')}:</span>
					{#if healthOk === true}
						<span class="text-green-600 dark:text-green-400">OK</span>
					{:else if healthOk === false}
						<span class="text-red-600 dark:text-red-400">{$i18n.t('Unreachable')}</span>
					{:else}
						—
					{/if}
				</div>
				{#if modelsError}
					<div class="text-xs text-red-600 dark:text-red-400">{modelsError}</div>
				{:else if modelCount !== null}
					<div class="text-xs">
						<span class="font-medium">{$i18n.t('Models')}:</span>
						{modelCount}
					</div>
				{/if}
			{/if}
		</div>
	</div>
</Modal>
