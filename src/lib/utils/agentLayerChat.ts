/** Persisted inside Open WebUI `chat` JSON (merged on POST /chats/{id}). */
export const AGENT_LAYER_CHAT_CHANNEL_KEY = 'agent_layer_channel';

/**
 * OpenAI-compatible `model` field for Agent Layer hybrid routing: backend chooses the real model.
 * Local UI still uses the first agent picker id for display / resolveModel where needed.
 */
export const AGENT_LAYER_DELEGATED_MODEL_ID = 'agent';

/** After `chat.completion`, align bubble header with the resolved model id from the API. */
export function applyResolvedModelFromCompletionToMessage(
	data: Record<string, unknown>,
	message: { model?: string; modelName?: string },
	resolveModel: (id: string) => { name?: string; id?: string } | undefined
): void {
	const raw = data.model;
	if (typeof raw !== 'string' || !raw.trim()) return;
	const id = raw.trim();
	message.model = id;
	const m = resolveModel(id);
	message.modelName = String(m?.name ?? m?.id ?? id);
}
