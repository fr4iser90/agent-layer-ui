<script lang="ts">
	import { getContext, onMount } from 'svelte';
	import { toast } from 'svelte-sonner';
	import { get } from 'svelte/store';
	import { settings, user } from '$lib/stores';
	import { updateUserSettings } from '$lib/apis/users';
	import { getAgentLayerUpstream } from '$lib/utils/agentLayerConnection';

	const i18n = getContext('i18n');

	type AgentLayerSettings = {
		enabled?: boolean;
		connections?: Array<{ url: string; token?: string; enable?: boolean }>;
		baseUrl?: string;
		token?: string;
		defaults?: {
			categories?: string[];
			domain?: string;
		};
	};

	let selectedTab: 'preferences' | 'secrets' | 'diagnostics' | 'connection' = 'preferences';

	let agentLayer: AgentLayerSettings = {};

	const isAdmin = () => $user?.role === 'admin';

	const getAgentConnection = () => {
		const up = getAgentLayerUpstream(get(settings));
		return { baseUrl: up?.baseUrl ?? '', token: up?.token ?? '' };
	};

	const agentAuthHeaders = () => {
		const { token } = getAgentConnection();
		return {
			Accept: 'application/json',
			...(token ? { Authorization: `Bearer ${token}` } : {})
		};
	};

	const saveUiSettings = async (updated: Partial<typeof $settings>) => {
		settings.set({ ...$settings, ...updated });
		await updateUserSettings(localStorage.token, { ui: { ...$settings, ...updated } });
	};

	// Preferences (user-level)
	let defaultCategories = '';
	let defaultDomain = '';

	const savePreferences = async () => {
		const categories = defaultCategories
			.split(',')
			.map((s) => s.trim())
			.filter((s) => s);

		const next: AgentLayerSettings = {
			...(agentLayer ?? {}),
			defaults: {
				categories,
				domain: defaultDomain.trim() || ''
			}
		};

		agentLayer = next;
		await saveUiSettings({ agentLayer: next } as any);
		toast.success($i18n.t('Settings saved successfully!'));
	};

	// Secrets
	let secretsLoading = false;
	let secretsError: string | null = null;
	let secrets: Array<{ service_key: string }> = [];

	let newServiceKey = '';
	let newSecret = '';

	const loadSecrets = async () => {
		const { baseUrl } = getAgentConnection();
		if (!baseUrl) return;

		secretsLoading = true;
		secretsError = null;
		try {
			const res = await fetch(`${baseUrl}/v1/user/secrets`, {
				method: 'GET',
				headers: agentAuthHeaders()
			});
			if (!res.ok) throw new Error(`Failed to load secrets (${res.status})`);
			const json = await res.json();
			secrets = (json?.secrets ?? json ?? []).map((s) => ({
				service_key: s.service_key ?? s
			}));
		} catch (e: any) {
			secretsError = e?.message ?? String(e);
			secrets = [];
		} finally {
			secretsLoading = false;
		}
	};

	const upsertSecret = async () => {
		const { baseUrl } = getAgentConnection();
		if (!baseUrl) return;
		if (!newServiceKey.trim()) return;

		let secretPayload: any = newSecret;
		try {
			secretPayload = JSON.parse(newSecret);
		} catch {
			// keep as string
		}

		try {
			const res = await fetch(`${baseUrl}/v1/user/secrets`, {
				method: 'POST',
				headers: { ...agentAuthHeaders(), 'Content-Type': 'application/json' },
				body: JSON.stringify({
					service_key: newServiceKey.trim(),
					secret: secretPayload
				})
			});
			if (!res.ok) throw new Error(`Failed to save secret (${res.status})`);
			toast.success($i18n.t('Settings saved successfully!'));
			newServiceKey = '';
			newSecret = '';
			await loadSecrets();
		} catch (e: any) {
			toast.error(e?.message ?? String(e));
		}
	};

	const deleteSecret = async (serviceKey: string) => {
		const { baseUrl } = getAgentConnection();
		if (!baseUrl) return;
		try {
			const res = await fetch(`${baseUrl}/v1/user/secrets/${encodeURIComponent(serviceKey)}`, {
				method: 'DELETE',
				headers: agentAuthHeaders()
			});
			if (!res.ok) throw new Error(`Failed to delete secret (${res.status})`);
			await loadSecrets();
		} catch (e: any) {
			toast.error(e?.message ?? String(e));
		}
	};

	// Diagnostics
	let healthStatus: null | 'ok' | 'error' = null;
	let healthDetail = '';
	let toolsCount: number | null = null;
	let categoriesCount: number | null = null;

	const runDiagnostics = async () => {
		const { baseUrl } = getAgentConnection();
		if (!baseUrl) return;

		healthStatus = null;
		healthDetail = '';
		toolsCount = null;
		categoriesCount = null;

		try {
			const healthRes = await fetch(`${baseUrl}/health`, { headers: agentAuthHeaders() });
			if (!healthRes.ok) throw new Error(`Health failed (${healthRes.status})`);
			const healthJson = await healthRes.json().catch(() => ({}));
			healthStatus = 'ok';
			healthDetail = JSON.stringify(healthJson);
		} catch (e: any) {
			healthStatus = 'error';
			healthDetail = e?.message ?? String(e);
		}

		try {
			const toolsRes = await fetch(`${baseUrl}/v1/tools`, { headers: agentAuthHeaders() });
			if (toolsRes.ok) {
				const json = await toolsRes.json();
				toolsCount = (json?.tools ?? []).length;
			}
		} catch {}

		try {
			const catRes = await fetch(`${baseUrl}/v1/router/categories`, { headers: agentAuthHeaders() });
			if (catRes.ok) {
				const json = await catRes.json();
				categoriesCount = (json?.categories ?? []).length;
			}
		} catch {}
	};

	// Admin connection editing (stored as UI setting; not backend-global)
	let editBaseUrl = '';
	let editToken = '';

	const saveConnection = async () => {
		if (!isAdmin()) return;
		const prev = (get(settings)?.agentLayer ?? {}) as AgentLayerSettings;
		const next: AgentLayerSettings = editBaseUrl.trim()
			? {
					...prev,
					enabled: true,
					connections: [
						{
							url: editBaseUrl.trim().replace(/\/$/, ''),
							token: editToken,
							enable: true
						}
					],
					baseUrl: undefined,
					token: undefined
				}
			: {
					...prev,
					enabled: false,
					connections: [],
					baseUrl: undefined,
					token: undefined
				};

		agentLayer = next;
		await saveUiSettings({ agentLayer: next } as any);
		toast.success($i18n.t('Settings saved successfully!'));
	};

	onMount(async () => {
		agentLayer = ($settings?.agentLayer ?? {}) as AgentLayerSettings;

		defaultCategories = (agentLayer?.defaults?.categories ?? []).join(',');
		defaultDomain = agentLayer?.defaults?.domain ?? '';

		const up = getAgentLayerUpstream(get(settings));
		editBaseUrl = up?.baseUrl ?? '';
		editToken = up?.token ?? '';

		await loadSecrets();
	});
</script>

<div class="py-4">
	<div class="flex flex-wrap items-center justify-between gap-2">
		<div class="text-xl font-semibold">{$i18n.t('Agent')} {$i18n.t('Settings')}</div>
		<div class="text-xs text-gray-500 dark:text-gray-400">
			{#if getAgentConnection().baseUrl}
				Connected: {getAgentConnection().baseUrl}
			{:else}
				Not connected
			{/if}
		</div>
	</div>

	<div class="mt-3 flex flex-wrap gap-2">
		<button
			class="text-sm px-3 py-1.5 rounded-full border transition font-medium {selectedTab === 'preferences'
				? 'bg-black text-white dark:bg-white dark:text-black border-transparent'
				: 'bg-transparent border-gray-200 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-900'}"
			type="button"
			on:click={() => (selectedTab = 'preferences')}
		>
			Preferences
		</button>
		<button
			class="text-sm px-3 py-1.5 rounded-full border transition font-medium {selectedTab === 'secrets'
				? 'bg-black text-white dark:bg-white dark:text-black border-transparent'
				: 'bg-transparent border-gray-200 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-900'}"
			type="button"
			on:click={() => (selectedTab = 'secrets')}
		>
			Secrets
		</button>
		<button
			class="text-sm px-3 py-1.5 rounded-full border transition font-medium {selectedTab === 'diagnostics'
				? 'bg-black text-white dark:bg-white dark:text-black border-transparent'
				: 'bg-transparent border-gray-200 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-900'}"
			type="button"
			on:click={() => (selectedTab = 'diagnostics')}
		>
			Diagnostics
		</button>
		{#if isAdmin()}
			<button
				class="text-sm px-3 py-1.5 rounded-full border transition font-medium {selectedTab === 'connection'
					? 'bg-black text-white dark:bg-white dark:text-black border-transparent'
					: 'bg-transparent border-gray-200 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-900'}"
				type="button"
				on:click={() => (selectedTab = 'connection')}
			>
				Connection
			</button>
		{/if}
	</div>

	{#if selectedTab === 'preferences'}
		<div class="mt-4 rounded-xl border border-gray-100 dark:border-gray-850 p-4">
			<div class="text-sm font-semibold mb-2">Routing defaults (Agent chat)</div>

			<div class="grid gap-3 md:grid-cols-2">
				<div>
					<div class="text-xs font-semibold text-gray-600 dark:text-gray-300">Default categories</div>
					<div class="text-xs text-gray-500 dark:text-gray-400 mb-1">Comma-separated</div>
					<input
						class="text-sm w-full bg-transparent outline-hidden rounded-lg px-3 py-2 border border-gray-100 dark:border-gray-850"
						placeholder="web,files"
						bind:value={defaultCategories}
					/>
				</div>
				<div>
					<div class="text-xs font-semibold text-gray-600 dark:text-gray-300">Default domain</div>
					<div class="text-xs text-gray-500 dark:text-gray-400 mb-1">Optional</div>
					<input
						class="text-sm w-full bg-transparent outline-hidden rounded-lg px-3 py-2 border border-gray-100 dark:border-gray-850"
						placeholder="web"
						bind:value={defaultDomain}
					/>
				</div>
			</div>

			<div class="mt-4 flex justify-end">
				<button
					class="px-3.5 py-1.5 text-sm font-medium bg-black hover:bg-gray-900 text-white dark:bg-white dark:text-black dark:hover:bg-gray-100 transition rounded-full"
					type="button"
					on:click={savePreferences}
				>
					{$i18n.t('Save')}
				</button>
			</div>
		</div>
	{:else if selectedTab === 'secrets'}
		<div class="mt-4 rounded-xl border border-gray-100 dark:border-gray-850 p-4">
			<div class="flex items-center justify-between gap-2">
				<div class="text-sm font-semibold">Secrets</div>
				<button
					class="text-xs px-2.5 py-1 rounded-full bg-gray-50 hover:bg-gray-100 dark:bg-gray-900 dark:hover:bg-gray-850 transition font-medium"
					type="button"
					on:click={loadSecrets}
					disabled={!getAgentConnection().baseUrl}
				>
					Refresh
				</button>
			</div>

			{#if !getAgentConnection().baseUrl}
				<div class="mt-2 text-sm text-gray-500 dark:text-gray-400">
					Set an Agent Layer connection first.
				</div>
			{:else}
				{#if secretsLoading}
					<div class="mt-2 text-sm text-gray-500 dark:text-gray-400">Loading…</div>
				{:else if secretsError}
					<div class="mt-2 text-sm text-red-600 dark:text-red-400">{secretsError}</div>
				{:else}
					<div class="mt-3 grid gap-2">
						{#each secrets as s (s.service_key)}
							<div class="flex items-center justify-between rounded-lg border border-gray-100 dark:border-gray-850 px-3 py-2">
								<div class="text-sm font-medium">{s.service_key}</div>
								<button
									class="text-xs px-2.5 py-1 rounded-full bg-gray-50 hover:bg-gray-100 dark:bg-gray-900 dark:hover:bg-gray-850 transition font-medium"
									type="button"
									on:click={() => deleteSecret(s.service_key)}
								>
									Delete
								</button>
							</div>
						{/each}
						{#if secrets.length === 0}
							<div class="text-sm text-gray-500 dark:text-gray-400">No secrets yet.</div>
						{/if}
					</div>

					<hr class="my-4 border-gray-100 dark:border-gray-850" />

					<div class="text-sm font-semibold mb-2">Add / Update secret</div>
					<div class="grid gap-3 md:grid-cols-2">
						<div>
							<div class="text-xs font-semibold text-gray-600 dark:text-gray-300">Service key</div>
							<input
								class="text-sm w-full bg-transparent outline-hidden rounded-lg px-3 py-2 border border-gray-100 dark:border-gray-850"
								placeholder="gmail"
								bind:value={newServiceKey}
							/>
						</div>
						<div>
							<div class="text-xs font-semibold text-gray-600 dark:text-gray-300">Secret (string or JSON)</div>
							<textarea
								class="text-sm w-full bg-transparent outline-hidden rounded-lg px-3 py-2 border border-gray-100 dark:border-gray-850"
								rows="3"
								placeholder="&#123;&quot;token&quot;:&quot;...&quot;&#125;"
								bind:value={newSecret}
							/>
						</div>
					</div>

					<div class="mt-4 flex justify-end">
						<button
							class="px-3.5 py-1.5 text-sm font-medium bg-black hover:bg-gray-900 text-white dark:bg-white dark:text-black dark:hover:bg-gray-100 transition rounded-full"
							type="button"
							on:click={upsertSecret}
							disabled={!newServiceKey.trim()}
						>
							Save secret
						</button>
					</div>
				{/if}
			{/if}
		</div>
	{:else if selectedTab === 'diagnostics'}
		<div class="mt-4 rounded-xl border border-gray-100 dark:border-gray-850 p-4">
			<div class="flex items-center justify-between gap-2">
				<div class="text-sm font-semibold">Diagnostics</div>
				<button
					class="text-xs px-2.5 py-1 rounded-full bg-gray-50 hover:bg-gray-100 dark:bg-gray-900 dark:hover:bg-gray-850 transition font-medium"
					type="button"
					on:click={runDiagnostics}
					disabled={!getAgentConnection().baseUrl}
				>
					Run
				</button>
			</div>

			{#if !getAgentConnection().baseUrl}
				<div class="mt-2 text-sm text-gray-500 dark:text-gray-400">
					No Agent Layer base URL configured.
				</div>
			{:else}
				<div class="mt-3 grid gap-2 text-sm">
					<div class="flex items-center justify-between">
						<div>Health</div>
						<div class="{healthStatus === 'ok' ? 'text-green-600 dark:text-green-400' : healthStatus === 'error' ? 'text-red-600 dark:text-red-400' : 'text-gray-500 dark:text-gray-400'}">
							{healthStatus ?? '—'}
						</div>
					</div>
					<div class="text-xs font-mono text-gray-500 dark:text-gray-400 break-all">{healthDetail || '—'}</div>
					<div class="flex items-center justify-between">
						<div>Tools</div>
						<div class="text-gray-600 dark:text-gray-300">{toolsCount ?? '—'}</div>
					</div>
					<div class="flex items-center justify-between">
						<div>Categories</div>
						<div class="text-gray-600 dark:text-gray-300">{categoriesCount ?? '—'}</div>
					</div>
				</div>
			{/if}
		</div>
	{:else if selectedTab === 'connection'}
		<div class="mt-4 rounded-xl border border-gray-100 dark:border-gray-850 p-4">
			<div class="text-sm font-semibold mb-2">Agent Layer connection (admin)</div>
			<div class="text-xs text-gray-500 dark:text-gray-400 mb-3">
				Stored as UI settings for this admin user. Operator-admin remains in Agent Layer.
			</div>

			<div class="grid gap-3 md:grid-cols-2">
				<div>
					<div class="text-xs font-semibold text-gray-600 dark:text-gray-300">Base URL</div>
					<input
						class="text-sm w-full bg-transparent outline-hidden rounded-lg px-3 py-2 border border-gray-100 dark:border-gray-850"
						placeholder="http://agent:8088"
						bind:value={editBaseUrl}
					/>
				</div>
				<div>
					<div class="text-xs font-semibold text-gray-600 dark:text-gray-300">Bearer Token (optional)</div>
					<input
						class="text-sm w-full bg-transparent outline-hidden rounded-lg px-3 py-2 border border-gray-100 dark:border-gray-850"
						placeholder="eyJhbGciOi..."
						bind:value={editToken}
					/>
				</div>
			</div>

			<div class="mt-4 flex justify-end">
				<button
					class="px-3.5 py-1.5 text-sm font-medium bg-black hover:bg-gray-900 text-white dark:bg-white dark:text-black dark:hover:bg-gray-100 transition rounded-full"
					type="button"
					on:click={saveConnection}
				>
					{$i18n.t('Save')}
				</button>
			</div>
		</div>
	{/if}
</div>

