<script lang="ts">
	import { getContext } from 'svelte';
	const i18n = getContext('i18n');
</script>

<div class="py-6">
	<div class="text-xl font-semibold">{$i18n.t('Images')}</div>
	<div class="mt-2 text-sm text-gray-500 dark:text-gray-400">
		Coming soon.
	</div>
</div>

