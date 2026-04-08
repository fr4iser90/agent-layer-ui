import { normalizeAgentLayerV1Url } from '$lib/apis/openai';
import type { Model } from '$lib/stores';

/**
 * Fetches public GET /v1/models from Agent Layer and maps entries to UI {@link Model} rows for the picker.
 */
export async function fetchAgentLayerModelsForPicker(
	baseUrl: string,
	token: string
): Promise<Model[]> {
	const v1 = normalizeAgentLayerV1Url(baseUrl);
	const headers: Record<string, string> = { Accept: 'application/json' };
	if (token) {
		headers.Authorization = `Bearer ${token}`;
	}

	const res = await fetch(`${v1}/models`, { headers });
	if (!res.ok) {
		return [];
	}

	const json = await res.json();
	const rows = Array.isArray(json?.data)
		? json.data
		: Array.isArray(json?.models)
			? json.models
			: [];

	return rows.map((row: Record<string, unknown>, i: number) => {
		const id = String(row.id ?? row.name ?? row.model ?? `model-${i}`);
		const name = String(row.name ?? row.model ?? row.id ?? id);
		return {
			id,
			name,
			owned_by: 'openai' as const,
			external: true,
			info: {
				meta: {
					capabilities: { 'agent-layer': true },
					description: 'Agent Layer'
				}
			}
		} as Model;
	});
}
