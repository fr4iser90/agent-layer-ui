<script lang="ts">
	import { getContext } from 'svelte';
	import Checkbox from '$lib/components/common/Checkbox.svelte';
	import Tooltip from '$lib/components/common/Tooltip.svelte';
	import { marked } from 'marked';

	const i18n = getContext('i18n');

	const helpText = {
		vision: $i18n.t('Model accepts image inputs'),
		usage: $i18n.t(
			'Sends `stream_options: { include_usage: true }` in the request.\nSupported providers will return token usage information in the response when set.'
		),
		citations: $i18n.t('Displays citations in the response'),
		['agent-layer']: $i18n.t(
			'Routes chat completions through Agent Layer (dedicated Agent views/routes can use this capability without affecting normal chat).'
		)
	};

	export let capabilities: {
		vision?: boolean;
		usage?: boolean;
		citations?: boolean;
		['agent-layer']?: boolean;
	} = {};
</script>

<div>
	<div class="flex w-full justify-between mb-1">
		<div class=" self-center text-sm font-semibold">{$i18n.t('Capabilities')}</div>
	</div>
	<div class="flex">
		{#each Object.keys(capabilities) as capability}
			<div class=" flex items-center gap-2 mr-3">
				<Checkbox
					state={capabilities[capability] ? 'checked' : 'unchecked'}
					on:change={(e) => {
						capabilities[capability] = e.detail === 'checked';
					}}
				/>

				<div class=" py-0.5 text-sm capitalize">
					<Tooltip content={marked.parse(helpText[capability] ?? '')}>
						{$i18n.t(capability)}
					</Tooltip>
				</div>
			</div>
		{/each}
	</div>
</div>
