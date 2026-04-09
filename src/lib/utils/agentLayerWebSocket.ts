/**
 * Agent Layer WebSocket chat (§4.3 WEBUI_CONTRACT): /ws/v1/chat
 * Browser: auth via ?token= (custom handshake headers are not reliably available in browsers).
 */

import { resolveAgentLayerOrigin } from '$lib/utils/agentLayerConnection';

export type AgentLayerWsChatResult = {
	data: Record<string, unknown>;
	aborted?: boolean;
};

/** Build wss://host/ws/v1/chat?token=… from configured Agent Layer base URL. */
export function buildAgentLayerWsUrl(baseUrl: string, token: string): string {
	const root = resolveAgentLayerOrigin(baseUrl);
	const base = root.endsWith('/') ? root : `${root}/`;
	const u = new URL('ws/v1/chat', base);
	u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:';
	if (token) u.searchParams.set('token', token);
	return u.href;
}

export function sendAgentLayerWsCancel(ws: WebSocket | null) {
	if (ws?.readyState === WebSocket.OPEN) {
		try {
			ws.send(JSON.stringify({ type: 'cancel' }));
		} catch {
			/* ignore */
		}
	}
}

export function sendAgentLayerWsAddTools(ws: WebSocket | null, names: string[]) {
	if (ws?.readyState === WebSocket.OPEN && names.length > 0) {
		try {
			ws.send(JSON.stringify({ type: 'add_tools', names }));
		} catch {
			/* ignore */
		}
	}
}

export function sendAgentLayerWsContinueStep(ws: WebSocket | null) {
	if (ws?.readyState === WebSocket.OPEN) {
		try {
			ws.send(JSON.stringify({ type: 'continue_step' }));
		} catch {
			/* ignore */
		}
	}
}

function messageType(msg: Record<string, unknown>): string | undefined {
	const t = msg.type ?? msg.event ?? msg.kind;
	return typeof t === 'string' ? t : undefined;
}

/**
 * Agent Layer WS does not mirror OpenAI token streaming: `agent.llm_round` carries
 * `content_excerpt` (~preview for timeline only) and `tool_calls`, not deltas.
 * Do not append excerpts to the chat bubble — final text comes only from `chat.completion.data`.
 */

/** Normalize OpenAI-shaped completion from a WS frame (top-level or under `data`). */
export function extractOpenAiCompletionData(msg: Record<string, unknown>): Record<string, unknown> | null {
	const inner = msg.data;
	if (inner && typeof inner === 'object' && 'choices' in inner) {
		return inner as Record<string, unknown>;
	}
	if ('choices' in msg && Array.isArray((msg as { choices?: unknown }).choices)) {
		return msg as Record<string, unknown>;
	}
	const payload = msg.payload;
	if (payload && typeof payload === 'object' && 'choices' in (payload as object)) {
		return payload as Record<string, unknown>;
	}
	return null;
}

/** If normalized completion omits `model`, copy it from the raw WS frame (OpenAI puts it next to `choices`). */
function mergeModelFromWsFrame(frame: Record<string, unknown>, data: Record<string, unknown>): void {
	if (typeof data.model === 'string' && data.model.trim()) return;
	const inner = frame.data;
	if (inner && typeof inner === 'object') {
		const m = (inner as Record<string, unknown>).model;
		if (typeof m === 'string' && m.trim()) {
			data.model = m.trim();
			return;
		}
	}
	const fm = frame.model;
	if (typeof fm === 'string' && fm.trim()) {
		data.model = fm.trim();
	}
}

export type RunAgentLayerWsChatOptions = {
	baseUrl: string;
	token: string;
	/** OpenAI chat body; `stream` / `stream_options` are stripped before send. */
	body: Record<string, unknown>;
	routerCategoriesHeader?: string;
	toolDomainHeader?: string;
	signal?: AbortSignal;
	/** Reserved — Agent Layer WS is not token-streamed; final text is only in `chat.completion.data`. */
	onDelta?: (chunk: string) => void;
	/** Raw server frames (for UI hooks / debugging). */
	onFrame?: (msg: Record<string, unknown>) => void;
	/** Active socket (for continue_step / add_tools while turn is in progress). */
	onOpen?: (ws: WebSocket) => void;
	/** Server is blocked on human-in-the-loop until client sends continue_step. */
	onStepWait?: (msg: Record<string, unknown>) => void;
};

/**
 * One chat turn: send `chat`, then wait for a terminal frame:
 * `chat.completion` (success or error-shaped), or `type: error`, or connection loss.
 * `agent.*` frames are for timeline only (handled via onFrame); not terminal except as above.
 */
export function runAgentLayerWsChatTurn(
	opts: RunAgentLayerWsChatOptions
): Promise<AgentLayerWsChatResult> {
	const url = buildAgentLayerWsUrl(opts.baseUrl, opts.token);

	return new Promise((resolve, reject) => {
		let ws: WebSocket;
		let settled = false;

		const finish = (result: AgentLayerWsChatResult) => {
			if (settled) return;
			settled = true;
			try {
				ws?.close();
			} catch {
				/* ignore */
			}
			resolve(result);
		};

		const fail = (err: unknown) => {
			if (settled) return;
			settled = true;
			try {
				ws?.close();
			} catch {
				/* ignore */
			}
			reject(err);
		};

		const onAbort = () => {
			sendAgentLayerWsCancel(ws);
			try {
				ws?.close();
			} catch {
				/* ignore */
			}
		};

		opts.signal?.addEventListener('abort', onAbort, { once: true });

		try {
			ws = new WebSocket(url);
		} catch (e) {
			opts.signal?.removeEventListener('abort', onAbort);
			fail(e);
			return;
		}

		ws.onopen = () => {
			opts.onOpen?.(ws);

			const body = { ...opts.body };
			delete body.stream;
			delete body.stream_options;

			const frame: Record<string, unknown> = {
				type: 'chat',
				body
			};
			if (opts.routerCategoriesHeader) {
				frame.router_categories_header = opts.routerCategoriesHeader;
			}
			if (opts.toolDomainHeader) {
				frame.tool_domain_header = opts.toolDomainHeader;
			}

			try {
				ws.send(JSON.stringify(frame));
			} catch (e) {
				fail(e);
			}
		};

		ws.onmessage = (ev) => {
			if (typeof ev.data !== 'string') return;

			let msg: Record<string, unknown>;
			try {
				msg = JSON.parse(ev.data) as Record<string, unknown>;
			} catch {
				return;
			}

			opts.onFrame?.(msg);

			const t = messageType(msg);
			if (!t && extractOpenAiCompletionData(msg)) {
				opts.signal?.removeEventListener('abort', onAbort);
				const d = extractOpenAiCompletionData(msg)!;
				mergeModelFromWsFrame(msg, d);
				finish({ data: d });
				return;
			}

			if (t === 'pong') return;

			if (t === 'agent.step_wait' || t === 'agent_step_wait') {
				opts.onStepWait?.(msg);
			}

			if (t === 'error') {
				fail(msg);
				return;
			}

			if (t === 'chat.completion' || t === 'chat_completion') {
				const normalized = extractOpenAiCompletionData(msg);
				if (normalized) {
					opts.signal?.removeEventListener('abort', onAbort);
					mergeModelFromWsFrame(msg, normalized);
					finish({ data: normalized });
					return;
				}
				if (msg.data && typeof msg.data === 'object') {
					opts.signal?.removeEventListener('abort', onAbort);
					const d = msg.data as Record<string, unknown>;
					mergeModelFromWsFrame(msg, d);
					finish({ data: d });
					return;
				}
			}

			/* agent.done / agent.aborted / agent.llm_round: timeline + onFrame only; terminal is chat.completion or error */
		};

		ws.onerror = () => {
			fail(new Error('WebSocket connection failed'));
		};

		ws.onclose = () => {
			opts.signal?.removeEventListener('abort', onAbort);
			if (!settled) {
				if (opts.signal?.aborted) {
					finish({ data: {}, aborted: true });
				} else {
					fail({
						type: 'error',
						detail: 'ws_connection_closed',
						message:
							'WebSocket closed before chat.completion (idle timeout, server error, or network drop).'
					});
				}
			}
		};
	});
}
