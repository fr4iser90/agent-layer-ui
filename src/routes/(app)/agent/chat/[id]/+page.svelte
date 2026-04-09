<script lang="ts">
	import { page } from '$app/stores';
	import AgentChatPage from '$lib/components/agent/AgentChatPage.svelte';
</script>

<AgentChatPage chatIdProp={$page.params.id} />
