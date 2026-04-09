export type AgentLayerConnectionRow = {
	url: string;
	token?: string;
	enable?: boolean;
};

export type AgentLayerUiSettings = {
	enabled?: boolean;
	connections?: AgentLayerConnectionRow[];
	baseUrl?: string;
	token?: string;
	defaults?: {
		categories?: string[];
		domain?: string;
		/** WebSocket only: pause after tool rounds until user sends continue_step (§4.3). */
		pauseBetweenRounds?: boolean;
	};
};

/**
 * Resolves the primary Agent Layer upstream (first enabled connection with a URL).
 * Honors `enabled: false`. Supports legacy `{ baseUrl, token }`.
 */
/**
 * Normalizes configured base URL to an origin without trailing `/v1`,
 * so callers can append `/v1/...` paths consistently (matches WS URL builder).
 */
export function resolveAgentLayerOrigin(baseUrl: string): string {
	let root = baseUrl.trim().replace(/\/$/, '');
	if (root.endsWith('/v1')) root = root.slice(0, -3).replace(/\/$/, '');
	return root;
}

export function getAgentLayerUpstream(settings: {
	agentLayer?: AgentLayerUiSettings | null;
}): { baseUrl: string; token: string } | null {
	const al = settings?.agentLayer;
	if (!al) return null;
	if (al.enabled === false) return null;

	const list = al.connections ?? [];
	const active = list.filter((c) => c?.url?.trim() && c.enable !== false);
	if (active.length > 0) {
		const c = active[0];
		return {
			baseUrl: c.url.trim().replace(/\/$/, ''),
			token: (c.token ?? '').trim()
		};
	}

	const legacy = (al.baseUrl ?? '').trim();
	if (legacy) {
		return {
			baseUrl: legacy.replace(/\/$/, ''),
			token: (al.token ?? '').trim()
		};
	}

	return null;
}
