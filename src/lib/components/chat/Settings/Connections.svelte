<script lang="ts">
	import { toast } from 'svelte-sonner';
	import { onMount, getContext } from 'svelte';

	const i18n = getContext('i18n');

	import { settings } from '$lib/stores';

	import Switch from '$lib/components/common/Switch.svelte';
	import Spinner from '$lib/components/common/Spinner.svelte';
	import Tooltip from '$lib/components/common/Tooltip.svelte';
	import Plus from '$lib/components/icons/Plus.svelte';
	import Connection from './Connections/Connection.svelte';
	import AgentLayerConnection from '$lib/components/admin/Settings/Connections/AgentLayerConnection.svelte';

	import AddConnectionModal from '$lib/components/AddConnectionModal.svelte';

	export let saveSettings: Function;

	let config = null;
	let ENABLE_AGENT_LAYER = false;
	let AGENT_LAYER_URLS: string[] = [];
	let AGENT_LAYER_CONFIGS: Record<number, { enable?: boolean; key?: string }> = {};

	let showConnectionModal = false;
	let showAddAgentLayerConnectionModal = false;

	const addConnectionHandler = async (connection) => {
		config.OPENAI_API_BASE_URLS.push(connection.url);
		config.OPENAI_API_KEYS.push(connection.key);
		config.OPENAI_API_CONFIGS[config.OPENAI_API_BASE_URLS.length - 1] = connection.config;

		await updateHandler();
	};

	const buildAgentLayerPayload = () => {
		const prev = $settings?.agentLayer ?? {};
		const connections = ENABLE_AGENT_LAYER
			? AGENT_LAYER_URLS.map((url, idx) => ({
					url: (url ?? '').trim().replace(/\/$/, ''),
					token: AGENT_LAYER_CONFIGS[idx]?.key ?? '',
					enable: AGENT_LAYER_CONFIGS[idx]?.enable !== false
				})).filter((c) => c.url)
			: [];

		return {
			...prev,
			enabled: ENABLE_AGENT_LAYER,
			connections,
			baseUrl: undefined,
			token: undefined
		};
	};

	const addAgentLayerConnectionHandler = async (connection) => {
		AGENT_LAYER_URLS = [...AGENT_LAYER_URLS, connection.url];
		AGENT_LAYER_CONFIGS[AGENT_LAYER_URLS.length - 1] = {
			enable: connection.config?.enable !== false,
			key: connection.key
		};

		await updateHandler();
	};

	const updateHandler = async () => {
		// Remove trailing slashes
		config.OPENAI_API_BASE_URLS = config.OPENAI_API_BASE_URLS.map((url) => url.replace(/\/$/, ''));

		// Check if API KEYS length is same than API URLS length
		if (config.OPENAI_API_KEYS.length !== config.OPENAI_API_BASE_URLS.length) {
			// if there are more keys than urls, remove the extra keys
			if (config.OPENAI_API_KEYS.length > config.OPENAI_API_BASE_URLS.length) {
				config.OPENAI_API_KEYS = config.OPENAI_API_KEYS.slice(
					0,
					config.OPENAI_API_BASE_URLS.length
				);
			}

			// if there are more urls than keys, add empty keys
			if (config.OPENAI_API_KEYS.length < config.OPENAI_API_BASE_URLS.length) {
				const diff = config.OPENAI_API_BASE_URLS.length - config.OPENAI_API_KEYS.length;
				for (let i = 0; i < diff; i++) {
					config.OPENAI_API_KEYS.push('');
				}
			}
		}

		await saveSettings({
			directConnections: config,
			agentLayer: buildAgentLayerPayload()
		});
	};

	onMount(async () => {
		config = $settings?.directConnections ?? {
			OPENAI_API_BASE_URLS: [],
			OPENAI_API_KEYS: [],
			OPENAI_API_CONFIGS: {}
		};

		const al = $settings?.agentLayer ?? {};
		if (al.enabled === false) {
			ENABLE_AGENT_LAYER = false;
		} else if (al.enabled === true) {
			ENABLE_AGENT_LAYER = true;
		} else {
			ENABLE_AGENT_LAYER = !!(
				(al.baseUrl ?? '').trim() ||
				al.connections?.some((c: { url?: string }) => c?.url?.trim())
			);
		}

		if (al.connections?.length) {
			AGENT_LAYER_URLS = al.connections.map((c: { url: string }) => c.url);
			al.connections.forEach(
				(c: { token?: string; enable?: boolean }, idx: number) => {
					AGENT_LAYER_CONFIGS[idx] = {
						enable: c.enable !== false,
						key: c.token ?? ''
					};
				}
			);
		} else if ((al.baseUrl ?? '').trim()) {
			AGENT_LAYER_URLS = [al.baseUrl];
			AGENT_LAYER_CONFIGS[0] = { enable: true, key: al.token ?? '' };
		} else {
			AGENT_LAYER_URLS = [];
		}

		for (let i = 0; i < AGENT_LAYER_URLS.length; i++) {
			if (!AGENT_LAYER_CONFIGS[i]) {
				AGENT_LAYER_CONFIGS[i] = { enable: true, key: '' };
			}
		}
	});
</script>

<AddConnectionModal direct bind:show={showConnectionModal} onSubmit={addConnectionHandler} />

<AddConnectionModal
	agentLayer
	bind:show={showAddAgentLayerConnectionModal}
	onSubmit={addAgentLayerConnectionHandler}
/>

<form
	class="flex flex-col h-full justify-between text-sm"
	on:submit|preventDefault={() => {
		updateHandler();
	}}
>
	<div class=" overflow-y-scroll scrollbar-hidden h-full">
		{#if config !== null}
			<div class="">
				<div class="pr-1.5">
					<div class="mb-4">
						<div class="flex justify-between items-center text-sm mb-2">
							<div class="font-medium">{$i18n.t('Agent Layer API')}</div>
							<Switch
								bind:state={ENABLE_AGENT_LAYER}
								on:change={async () => {
									await updateHandler();
								}}
							/>
						</div>

						{#if ENABLE_AGENT_LAYER}
							<hr class=" border-gray-100 dark:border-gray-850 my-2" />

							<div class="flex justify-between items-center">
								<div class="font-medium">{$i18n.t('Manage Agent Layer Connections')}</div>

								<Tooltip content={$i18n.t(`Add Connection`)}>
									<button
										class="px-1"
										on:click={() => {
											showAddAgentLayerConnectionModal = true;
										}}
										type="button"
									>
										<Plus />
									</button>
								</Tooltip>
							</div>

							<div class="flex flex-col gap-1.5 mt-1.5">
								{#each AGENT_LAYER_URLS as url, idx}
									<AgentLayerConnection
										bind:url
										bind:config={AGENT_LAYER_CONFIGS[idx]}
										onSubmit={() => {
											updateHandler();
										}}
										onDelete={() => {
											AGENT_LAYER_URLS = AGENT_LAYER_URLS.filter((u, urlIdx) => idx !== urlIdx);

											const newConfig = {};
											AGENT_LAYER_URLS.forEach((u, newIdx) => {
												newConfig[newIdx] =
													AGENT_LAYER_CONFIGS[newIdx < idx ? newIdx : newIdx + 1];
											});
											AGENT_LAYER_CONFIGS = newConfig;
											updateHandler();
										}}
									/>
								{/each}
							</div>

							<div class="mt-2 text-xs text-gray-500">
								{$i18n.t('Used by the dedicated /agent/* views. Normal chat remains unchanged.')}
							</div>
						{/if}
					</div>

					<div class="">
						<div class="flex justify-between items-center mb-0.5">
							<div class="font-medium">{$i18n.t('Manage Direct Connections')}</div>

							<Tooltip content={$i18n.t(`Add Connection`)}>
								<button
									class="px-1"
									on:click={() => {
										showConnectionModal = true;
									}}
									type="button"
								>
									<Plus />
								</button>
							</Tooltip>
						</div>

						<div class="flex flex-col gap-1.5">
							{#each config?.OPENAI_API_BASE_URLS ?? [] as url, idx}
								<Connection
									bind:url
									bind:key={config.OPENAI_API_KEYS[idx]}
									bind:config={config.OPENAI_API_CONFIGS[idx]}
									onSubmit={() => {
										updateHandler();
									}}
									onDelete={() => {
										config.OPENAI_API_BASE_URLS = config.OPENAI_API_BASE_URLS.filter(
											(url, urlIdx) => idx !== urlIdx
										);
										config.OPENAI_API_KEYS = config.OPENAI_API_KEYS.filter(
											(key, keyIdx) => idx !== keyIdx
										);

										let newConfig = {};
										config.OPENAI_API_BASE_URLS.forEach((url, newIdx) => {
											newConfig[newIdx] =
												config.OPENAI_API_CONFIGS[newIdx < idx ? newIdx : newIdx + 1];
										});
										config.OPENAI_API_CONFIGS = newConfig;
									}}
								/>
							{/each}
						</div>
					</div>

					<div class="my-1.5">
						<div class="text-xs text-gray-500">
							{$i18n.t('Connect to your own OpenAI compatible API endpoints.')}
							<br />
							{$i18n.t(
								'CORS must be properly configured by the provider to allow requests from Open WebUI.'
							)}
						</div>
					</div>
				</div>
			</div>
		{:else}
			<div class="flex h-full justify-center">
				<div class="my-auto">
					<Spinner className="size-6" />
				</div>
			</div>
		{/if}
	</div>

	<div class="flex justify-end pt-3 text-sm font-medium">
		<button
			class="px-3.5 py-1.5 text-sm font-medium bg-black hover:bg-gray-900 text-white dark:bg-white dark:text-black dark:hover:bg-gray-100 transition rounded-full"
			type="submit"
		>
			{$i18n.t('Save')}
		</button>
	</div>
</form>
