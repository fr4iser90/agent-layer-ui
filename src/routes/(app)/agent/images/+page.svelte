<script lang="ts">
	import { getContext, onMount } from 'svelte';
	import { get, type Writable } from 'svelte/store';
	import type { i18n as I18nCore } from 'i18next';
	import { toast } from 'svelte-sonner';

	import {
		applyCheckpointListToFields,
		createStudioJob,
		fetchStudioCatalog,
		fetchStudioCheckpoints,
		fieldsFromInputsSchema,
		StudioHttpError,
		studioResultPreviewUrl,
		summarizeStudioJobForDisplay,
		type StudioFieldDef,
		type StudioJobResponse,
		type StudioPreset
	} from '$lib/apis/agentLayer/studio';
	import { getAgentLayerUpstream } from '$lib/utils/agentLayerConnection';
	import { settings, user } from '$lib/stores';

	const i18n = getContext<Writable<I18nCore>>('i18n');

	type SettingsWithAgent = { agentLayer?: import('$lib/utils/agentLayerConnection').AgentLayerUiSettings | null };

	$: agentUp = getAgentLayerUpstream($settings as SettingsWithAgent);

	const resolveAgentUp = () => getAgentLayerUpstream(get(settings) as SettingsWithAgent);

	const KIND_ORDER = [
		'txt2img',
		'text_to_image',
		'img2img',
		'image_to_image',
		'inpaint',
		'outpaint',
		'upscale'
	];

	function kindSortKey(kind: string): number {
		const i = KIND_ORDER.indexOf(kind);
		return i === -1 ? 1000 : i;
	}

	function groupPresets(list: StudioPreset[]): { kind: string; items: StudioPreset[] }[] {
		const m = new Map<string, StudioPreset[]>();
		for (const p of list) {
			const k = (p.kind || 'other').trim() || 'other';
			if (!m.has(k)) m.set(k, []);
			m.get(k)!.push(p);
		}
		return [...m.entries()]
			.sort((a, b) => {
				const da = kindSortKey(a[0]);
				const db = kindSortKey(b[0]);
				if (da !== db) return da - db;
				return a[0].localeCompare(b[0]);
			})
			.map(([kind, items]) => ({ kind, items }));
	}

	function presetSupportsCheckpointPicker(p: StudioPreset | null): boolean {
		if (!p) return false;
		const k = (p.kind || '').toLowerCase();
		return k === 'txt2img' || k === 'text_to_image' || k === 'inpaint';
	}

	function schemaHasCheckpointProperty(schema: StudioPreset['inputs_schema']): boolean {
		const p = schema?.properties;
		if (!p || typeof p !== 'object') return false;
		return 'checkpoint' in p || 'ckpt_name' in p;
	}

	function kindSectionLabel(kind: string): string {
		const t = get(i18n).t;
		const labels: Record<string, string> = {
			txt2img: t('Image generation'),
			text_to_image: t('Image generation'),
			img2img: t('Image edit'),
			image_to_image: t('Image edit'),
			inpaint: t('Inpaint'),
			outpaint: t('Outpaint'),
			upscale: t('Upscale'),
			other: t('Other workflows')
		};
		return labels[kind] ?? kind.replace(/_/g, ' ');
	}

	let presets: StudioPreset[] = [];
	let catalogOk = false;
	let catalogHttpStatus: number | undefined;
	let catalogFetchError: string | undefined;
	let studioVersion: string | undefined;
	let engineDefault: string | undefined;
	let loading = true;
	let selected: StudioPreset | null = null;
	let inputs: Record<string, unknown> = {};
	let submitting = false;
	let lastJobJson: string | null = null;
	let lastJobPreviewUrl: string | null = null;

	let checkpoints: string[] = [];
	let checkpointFetchError: string | undefined;

	$: formFields = selected
		? applyCheckpointListToFields(
				fieldsFromInputsSchema(selected.inputs_schema),
				checkpoints
			)
		: [];
	/** Extra dropdown when the preset has no `checkpoint` / `ckpt_name` in `inputs_schema` (catalog cannot inject enum there). */
	$: showExtraCheckpointDropdown =
		!!selected &&
		presetSupportsCheckpointPicker(selected) &&
		!schemaHasCheckpointProperty(selected.inputs_schema) &&
		checkpoints.length > 0;

	function initInputsFromFields(fs: StudioFieldDef[]) {
		const next: Record<string, unknown> = {};
		for (const f of fs) {
			if (f.default !== undefined) next[f.id] = f.default;
		}
		return next;
	}

	function selectPreset(p: StudioPreset) {
		selected = p;
		const base = fieldsFromInputsSchema(p.inputs_schema);
		inputs = initInputsFromFields(base);
		if (!schemaHasCheckpointProperty(p.inputs_schema) && presetSupportsCheckpointPicker(p)) {
			inputs.checkpoint = '';
		}
		lastJobJson = null;
		lastJobPreviewUrl = null;
	}

	function validate(fs: StudioFieldDef[]): string | null {
		const t = get(i18n).t;
		if (!selected) return t('Select a preset');
		for (const f of fs) {
			if (!f.required) continue;
			const v = inputs[f.id];
			if (v === undefined || v === null || v === '' || (typeof v === 'number' && Number.isNaN(v))) {
				return t('Fill required fields.');
			}
		}
		return null;
	}

	async function readFileAsDataUrl(file: File): Promise<string> {
		return new Promise((resolve, reject) => {
			const r = new FileReader();
			r.onload = () => resolve(String(r.result ?? ''));
			r.onerror = () => reject(r.error);
			r.readAsDataURL(file);
		});
	}

	async function onFileField(field: StudioFieldDef, e: Event) {
		const input = e.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) {
			delete inputs[field.id];
			inputs = { ...inputs };
			return;
		}
		try {
			inputs[field.id] = await readFileAsDataUrl(file);
			inputs = { ...inputs };
		} catch {
			toast.error(get(i18n).t('Failed to upload file.'));
		}
	}

	const identityHeaders = (): Record<string, string> => {
		const u = get(user);
		if (u?.id) return { 'X-OpenWebUI-User-Id': String(u.id) };
		return {};
	};

	async function loadCatalog() {
		loading = true;
		catalogOk = false;
		catalogFetchError = undefined;
		catalogHttpStatus = undefined;
		const up = resolveAgentUp();
		try {
			if (!up?.baseUrl) {
				presets = [];
				studioVersion = undefined;
				engineDefault = undefined;
				checkpoints = [];
				checkpointFetchError = undefined;
				selected = null;
				inputs = {};
				return;
			}
			const r = await fetchStudioCatalog(up.baseUrl, up.token, identityHeaders());
			catalogHttpStatus = r.status;
			if (!r.ok) {
				presets = [];
				catalogFetchError = r.error;
				studioVersion = undefined;
				engineDefault = undefined;
				checkpoints = [];
				checkpointFetchError = undefined;
				selected = null;
				inputs = {};
				if (r.error) toast.error(r.error);
				return;
			}
			catalogOk = true;
			presets = r.presets;
			studioVersion = r.studio_version;
			engineDefault = r.engine_default;
			const ck = await fetchStudioCheckpoints(up.baseUrl, up.token, identityHeaders());
			if (ck.ok) {
				checkpoints = ck.checkpoints;
				checkpointFetchError = undefined;
			} else {
				checkpoints = [];
				checkpointFetchError = ck.error;
				if (ck.status === 502) {
					toast.info(get(i18n).t('Checkpoint list unavailable (ComfyUI).'));
				} else if (ck.error) {
					toast.error(ck.error);
				}
			}
			const current = selected;
			if (
				current == null ||
				!r.presets.some((p) => p.run_key === current.run_key)
			) {
				if (r.presets[0]) selectPreset(r.presets[0]);
				else {
					selected = null;
					inputs = {};
				}
			}
		} catch (e) {
			console.error(e);
			toast.error(String(e));
			presets = [];
			catalogOk = false;
			checkpoints = [];
			checkpointFetchError = undefined;
			selected = null;
			inputs = {};
		} finally {
			loading = false;
		}
	}

	async function onSubmit() {
		const err = validate(formFields);
		if (err) {
			toast.error(err);
			return;
		}
		const upSubmit = resolveAgentUp();
		if (!upSubmit?.baseUrl) {
			toast.error(get(i18n).t('Configure Agent Layer (base URL) in Agent settings to submit jobs.'));
			return;
		}
		if (!selected) return;
		submitting = true;
		lastJobJson = null;
		lastJobPreviewUrl = null;
		try {
			const jobInputs: Record<string, unknown> = { ...inputs };
			for (const k of ['checkpoint', 'ckpt_name'] as const) {
				if (jobInputs[k] === '') delete jobInputs[k];
			}
			const res: StudioJobResponse = await createStudioJob(
				upSubmit.baseUrl,
				upSubmit.token,
				{ run_key: selected.run_key, inputs: jobInputs },
				identityHeaders()
			);
			lastJobPreviewUrl = studioResultPreviewUrl(res);
			lastJobJson = summarizeStudioJobForDisplay(res);
			const t = get(i18n).t;
			const pid = res.prompt_id ?? res.job_id;
			toast.success(pid ? `${t('Studio job completed')}: ${pid}` : t('Studio job completed'));
		} catch (e) {
			if (e instanceof StudioHttpError) {
				lastJobJson = summarizeStudioJobForDisplay(e.body ?? { detail: e.message });
				const t = get(i18n).t;
				if (e.status === 501) {
					toast.info(t('Studio runner not implemented yet (501).'));
				} else if (e.status === 400) {
					toast.error(`${t('Studio job invalid (400).')} ${e.message}`);
				} else if (e.status === 502) {
					toast.error(`${t('Studio ComfyUI error (502).')} ${e.message}`);
				} else {
					toast.error(e.message);
				}
			} else {
				toast.error(String(e));
			}
		} finally {
			submitting = false;
		}
	}

	onMount(loadCatalog);

	$: grouped = groupPresets(presets);
</script>

<div class="py-6 max-w-6xl mx-auto">
	<div class="flex flex-wrap items-start justify-between gap-3">
		<div>
			<h1 class="text-xl font-semibold">{$i18n.t('Image Studio')}</h1>
			<p class="mt-1 text-sm text-gray-500 dark:text-gray-400 max-w-2xl">
				{$i18n.t('Schema-driven forms from the Agent Layer. Configure a connection under Agent → Settings.')}
			</p>
			<div class="mt-2 flex flex-wrap items-center gap-2 text-xs">
				{#if !agentUp?.baseUrl}
					<span class="rounded-full px-2 py-0.5 font-medium bg-amber-500/15 text-amber-900 dark:text-amber-100">
						{$i18n.t('No Agent Layer base URL — presets are not loaded.')}
					</span>
				{:else if loading}
					<span class="text-gray-500 dark:text-gray-400">{$i18n.t('Loading...')}</span>
				{:else if catalogOk && presets.length > 0}
					<span
						class="rounded-full px-2 py-0.5 font-medium bg-emerald-500/15 text-emerald-800 dark:text-emerald-200"
					>
						{$i18n.t('Studio catalog from server')}
					</span>
				{:else}
					<span class="rounded-full px-2 py-0.5 font-medium bg-amber-500/15 text-amber-900 dark:text-amber-100">
						{$i18n.t('No presets — check catalog or server logs.')}
					</span>
				{/if}
				{#if studioVersion}
					<span class="text-gray-500 dark:text-gray-400">v{studioVersion}</span>
				{/if}
				{#if engineDefault}
					<span class="text-gray-500 dark:text-gray-400"
						>{$i18n.t('Default engine')}: {engineDefault}</span
					>
				{/if}
				{#if catalogHttpStatus && !catalogOk}
					<span class="text-gray-500 dark:text-gray-400">HTTP {catalogHttpStatus}</span>
				{/if}
				<button
					type="button"
					class="text-xs underline text-gray-600 dark:text-gray-300 hover:text-black dark:hover:text-white"
					on:click={loadCatalog}
					disabled={loading}
				>
					{$i18n.t('Reload catalog')}
				</button>
			</div>
			{#if catalogFetchError && agentUp?.baseUrl}
				<p class="mt-2 text-xs text-red-600 dark:text-red-400 font-mono break-all">{catalogFetchError}</p>
			{/if}
		</div>
	</div>

	{#if loading}
		<div class="mt-10 text-sm text-gray-500">{$i18n.t('Loading...')}</div>
	{:else if !agentUp?.baseUrl}
		<div class="mt-10 text-sm text-gray-600 dark:text-gray-300">
			{$i18n.t('Configure Agent Layer (base URL) in Agent settings to load the studio catalog.')}
		</div>
	{:else if presets.length === 0}
		<div class="mt-10 text-sm text-gray-600 dark:text-gray-300">
			{$i18n.t('No presets in catalog. The server returned an empty list or the catalog could not be loaded.')}
		</div>
	{:else}
		<div class="mt-6 grid gap-6 lg:grid-cols-[minmax(220px,280px)_1fr]">
			<div class="space-y-5 lg:max-h-[calc(100dvh-12rem)] lg:overflow-y-auto pr-1">
				{#each grouped as group}
					<div>
						<div class="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-2">
							{kindSectionLabel(group.kind)}
						</div>
						<div class="flex flex-col gap-1">
							{#each group.items as p}
								<button
									type="button"
									class="text-left text-sm rounded-xl px-3 py-2 border transition {selected?.run_key === p.run_key
										? 'border-black dark:border-white bg-gray-50 dark:bg-gray-850'
										: 'border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-900'}"
									on:click={() => selectPreset(p)}
								>
									<div class="font-medium">{p.title}</div>
									{#if p.engine}
										<div class="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{p.engine}</div>
									{/if}
								</button>
							{/each}
						</div>
					</div>
				{/each}
			</div>

			<div class="rounded-2xl border border-gray-100 dark:border-gray-850 p-4 md:p-5">
				{#if selected}
					<h2 class="text-lg font-semibold">{selected.title}</h2>
					{#if selected.description}
						<p class="mt-1 text-sm text-gray-500 dark:text-gray-400">{selected.description}</p>
					{/if}
					<p class="mt-1 text-xs font-mono text-gray-400 dark:text-gray-500">
						run_key: {selected.run_key}
					</p>
					{#if selected.workflow_file}
						<p class="mt-0.5 text-xs font-mono text-gray-400 dark:text-gray-500">
							workflow_file: {selected.workflow_file}
						</p>
					{/if}

					<form class="mt-5 space-y-4" on:submit|preventDefault={onSubmit}>
						{#if showExtraCheckpointDropdown}
							<div class="rounded-xl border border-gray-100 dark:border-gray-850 px-3 py-3 space-y-2">
								<div class="text-xs font-semibold text-gray-600 dark:text-gray-300">
									{$i18n.t('Checkpoint (ComfyUI)')}
								</div>
								<select
									class="w-full text-sm bg-transparent rounded-xl px-3 py-2 border border-gray-100 dark:border-gray-850 outline-hidden"
									bind:value={inputs.checkpoint}
								>
									<option value="">{$i18n.t('Use workflow default')}</option>
									{#each checkpoints as ck}
										<option value={ck}>{ck}</option>
									{/each}
								</select>
							</div>
						{:else if presetSupportsCheckpointPicker(selected) && !schemaHasCheckpointProperty(selected.inputs_schema) && checkpoints.length === 0}
							<div class="rounded-xl border border-gray-100 dark:border-gray-850 px-3 py-3 space-y-2">
								<div class="text-xs font-semibold text-gray-600 dark:text-gray-300">
									{$i18n.t('Checkpoint (ComfyUI)')}
								</div>
								{#if checkpointFetchError}
									<p class="text-xs text-red-600 dark:text-red-400 font-mono break-all">
										{checkpointFetchError}
									</p>
								{:else}
									<p class="text-xs text-gray-500 dark:text-gray-400">
										{$i18n.t('No checkpoints returned — is ComfyUI running?')}
									</p>
								{/if}
							</div>
						{/if}
						{#each formFields as field}
							<div>
								<label class="block text-xs font-semibold text-gray-600 dark:text-gray-300 mb-1" for="sf-{field.id}">
									{field.label ?? field.id}
									{#if field.required}<span class="text-red-500">*</span>{/if}
								</label>
								{#if field.description}
									<p class="text-xs text-gray-500 dark:text-gray-400 mb-1">{field.description}</p>
								{/if}

								{#if field.type === 'text'}
									<textarea
										id="sf-{field.id}"
										class="w-full min-h-[88px] text-sm bg-transparent rounded-xl px-3 py-2 border border-gray-100 dark:border-gray-850 outline-hidden"
										value={String(inputs[field.id] ?? '')}
										on:input={(e) => {
											inputs[field.id] = e.currentTarget.value;
										}}
									/>
								{:else if field.type === 'string'}
									<input
										id="sf-{field.id}"
										type="text"
										class="w-full text-sm bg-transparent rounded-xl px-3 py-2 border border-gray-100 dark:border-gray-850 outline-hidden"
										value={String(inputs[field.id] ?? '')}
										on:input={(e) => {
											inputs[field.id] = e.currentTarget.value;
										}}
									/>
								{:else if field.type === 'number'}
									<input
										id="sf-{field.id}"
										type="number"
										step="any"
										min={field.min}
										max={field.max}
										class="w-full text-sm bg-transparent rounded-xl px-3 py-2 border border-gray-100 dark:border-gray-850 outline-hidden"
										value={inputs[field.id] === undefined ? '' : Number(inputs[field.id])}
										on:input={(e) => {
											const n = parseFloat(e.currentTarget.value);
											inputs[field.id] = Number.isNaN(n) ? '' : n;
										}}
									/>
								{:else if field.type === 'integer'}
									<input
										id="sf-{field.id}"
										type="number"
										step="1"
										min={field.min}
										max={field.max}
										class="w-full text-sm bg-transparent rounded-xl px-3 py-2 border border-gray-100 dark:border-gray-850 outline-hidden"
										value={inputs[field.id] === undefined ? '' : Number(inputs[field.id])}
										on:input={(e) => {
											const n = parseInt(e.currentTarget.value, 10);
											inputs[field.id] = Number.isNaN(n) ? '' : n;
										}}
									/>
								{:else if field.type === 'boolean'}
									<label class="flex items-center gap-2 text-sm">
										<input
											id="sf-{field.id}"
											type="checkbox"
											checked={Boolean(inputs[field.id])}
											on:change={(e) => {
												inputs[field.id] = e.currentTarget.checked;
											}}
										/>
										<span>{$i18n.t('Enabled')}</span>
									</label>
								{:else if field.type === 'enum' && field.enum?.length}
									<select
										id="sf-{field.id}"
										class="w-full text-sm bg-transparent rounded-xl px-3 py-2 border border-gray-100 dark:border-gray-850 outline-hidden"
										value={String(inputs[field.id] ?? field.default ?? field.enum[0])}
										on:change={(e) => {
											inputs[field.id] = e.currentTarget.value;
										}}
									>
										{#each field.enum as opt}
											<option value={opt}>{opt}</option>
										{/each}
									</select>
								{:else if field.type === 'image' || field.type === 'mask'}
									<input
										id="sf-{field.id}"
										type="file"
										accept={field.accept ?? 'image/*'}
										class="block w-full text-sm text-gray-600 dark:text-gray-300"
										on:change={(e) => onFileField(field, e)}
									/>
									{#if typeof inputs[field.id] === 'string' && String(inputs[field.id]).startsWith('data:')}
										<div class="mt-2 max-w-xs rounded-lg overflow-hidden border border-gray-100 dark:border-gray-800">
											<img src={String(inputs[field.id])} alt="" class="w-full h-auto max-h-40 object-contain" />
										</div>
									{/if}
								{:else}
									<input
										id="sf-{field.id}"
										type="text"
										class="w-full text-sm bg-transparent rounded-xl px-3 py-2 border border-gray-100 dark:border-gray-850 outline-hidden"
										value={String(inputs[field.id] ?? '')}
										on:input={(e) => {
											inputs[field.id] = e.currentTarget.value;
										}}
									/>
								{/if}
							</div>
						{/each}

						<div class="pt-2 flex flex-wrap items-center gap-3">
							<button
								type="submit"
								disabled={submitting}
								class="px-4 py-2 text-sm font-medium rounded-full bg-black text-white dark:bg-white dark:text-black disabled:opacity-50"
							>
								{submitting ? $i18n.t('Loading...') : $i18n.t('Run job')}
							</button>
							<span class="text-xs text-gray-500 dark:text-gray-400">POST /v1/studio/jobs</span>
						</div>
					</form>

					{#if lastJobPreviewUrl}
						<div class="mt-6">
							<div class="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-2">
								{$i18n.t('Result preview')}
							</div>
							<div
								class="max-w-full md:max-w-2xl rounded-xl overflow-hidden border border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-900"
							>
								<img
									src={lastJobPreviewUrl}
									alt=""
									class="w-full h-auto max-h-[min(70vh,720px)] object-contain"
								/>
							</div>
						</div>
					{/if}
					{#if lastJobJson}
						<div class="mt-6">
							<div class="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1">
								{$i18n.t('Job response')} ({$i18n.t('base64 redacted for display')})
							</div>
							<pre
								class="text-xs p-3 rounded-xl bg-gray-50 dark:bg-gray-900 border border-gray-100 dark:border-gray-800 overflow-x-auto">{lastJobJson}</pre>
						</div>
					{/if}
				{:else}
					<p class="text-sm text-gray-500">{$i18n.t('Select a preset')}</p>
				{/if}
			</div>
		</div>
	{/if}
</div>
