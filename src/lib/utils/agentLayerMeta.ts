/**
 * Metadata from Agent Layer chat completions (§4.1 WEBUI_CONTRACT):
 * JSON `agent_layer` and/or response headers (works for streaming).
 */
export type AgentLayerCompletionMeta = {
	forwarded_tools?: string[];
	forwarded_tool_count?: number;
	routed_category?: string;
	router_categories?: string[];
};

function splitCsv(v: string): string[] {
	return v
		.split(',')
		.map((s) => s.trim())
		.filter(Boolean);
}

export function parseAgentLayerMetaFromHeaders(res: Response): AgentLayerCompletionMeta | null {
	const countRaw =
		res.headers.get('X-Agent-Forwarded-Tool-Count') ??
		res.headers.get('x-agent-forwarded-tool-count');
	const routed =
		res.headers.get('X-Agent-Router-Category') ?? res.headers.get('x-agent-router-category');
	const catsRaw =
		res.headers.get('X-Agent-Router-Categories') ?? res.headers.get('x-agent-router-categories');
	const namesRaw =
		res.headers.get('X-Agent-Forwarded-Tool-Names') ??
		res.headers.get('x-agent-forwarded-tool-names');

	if (!countRaw && !routed?.trim() && !catsRaw?.trim() && !namesRaw?.trim()) {
		return null;
	}

	const n = countRaw != null && countRaw !== '' ? parseInt(countRaw, 10) : undefined;

	return {
		forwarded_tool_count: n !== undefined && !Number.isNaN(n) ? n : undefined,
		routed_category: routed?.trim() || undefined,
		router_categories: catsRaw?.trim() ? splitCsv(catsRaw) : undefined,
		forwarded_tools: namesRaw?.trim() ? splitCsv(namesRaw) : undefined
	};
}

export function parseAgentLayerFromJson(agentLayer: unknown): AgentLayerCompletionMeta | null {
	if (!agentLayer || typeof agentLayer !== 'object') return null;
	const j = agentLayer as Record<string, unknown>;
	const forwarded_tools = Array.isArray(j.forwarded_tools)
		? j.forwarded_tools.map((x) => String(x))
		: undefined;
	const router_categories = Array.isArray(j.router_categories)
		? j.router_categories.map((x) => String(x))
		: undefined;
	const forwarded_tool_count =
		typeof j.forwarded_tool_count === 'number' && !Number.isNaN(j.forwarded_tool_count)
			? j.forwarded_tool_count
			: undefined;
	const routed_category = typeof j.routed_category === 'string' ? j.routed_category : undefined;

	if (
		!forwarded_tools?.length &&
		forwarded_tool_count === undefined &&
		!routed_category &&
		!router_categories?.length
	) {
		return null;
	}

	return {
		forwarded_tools,
		forwarded_tool_count,
		routed_category,
		router_categories
	};
}

/** Read `agent_layer` from a final OpenAI-shaped completion object (e.g. WS `chat.completion.data`). */
export function agentLayerMetaFromChatCompletionData(data: unknown): AgentLayerCompletionMeta | null {
	if (!data || typeof data !== 'object') return null;
	return parseAgentLayerFromJson((data as Record<string, unknown>).agent_layer);
}

/** Prefer JSON body when present (full tool list); fill gaps from headers (streaming). */
export function mergeAgentLayerCompletionMeta(
	res: Response | null,
	jsonAgentLayer?: unknown
): AgentLayerCompletionMeta | null {
	const fromHeaders = res ? parseAgentLayerMetaFromHeaders(res) : null;
	const fromJson = parseAgentLayerFromJson(jsonAgentLayer);
	if (!fromHeaders && !fromJson) return null;

	return {
		forwarded_tools:
			fromJson?.forwarded_tools?.length ? fromJson.forwarded_tools : fromHeaders?.forwarded_tools,
		forwarded_tool_count: fromJson?.forwarded_tool_count ?? fromHeaders?.forwarded_tool_count,
		routed_category: fromJson?.routed_category ?? fromHeaders?.routed_category,
		router_categories:
			fromJson?.router_categories && fromJson.router_categories.length > 0
				? fromJson.router_categories
				: fromHeaders?.router_categories
	};
}
