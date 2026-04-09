/**
 * Image Studio ↔ Agent Layer (WEBUI_CONTRACT §11).
 *
 * - GET  /v1/studio/catalog → presets + inputs_schema (JSON Schema object)
 * - POST /v1/studio/jobs   → { run_key, inputs }; 200 embeds Comfy outputs in JSON (data_url)
 */

import { resolveAgentLayerOrigin } from '$lib/utils/agentLayerConnection';

/** JSON Schema property subset used for dynamic Studio forms. */
export type StudioJsonSchemaProperty = {
	type?: string;
	title?: string;
	description?: string;
	default?: unknown;
	enum?: unknown[];
	minimum?: number;
	maximum?: number;
	format?: string;
	maxLength?: number;
	contentEncoding?: string;
	contentMediaType?: string;
	/** Extension: file widget for image (data URL in inputs). */
	'x-studio-widget'?: 'image' | 'mask' | 'textarea';
};

export type StudioInputsSchema = {
	type?: string;
	properties?: Record<string, StudioJsonSchemaProperty>;
	required?: string[];
};

export type StudioPreset = {
	run_key: string;
	title: string;
	description?: string;
	kind: string;
	engine?: string;
	workflow_file?: string;
	/** JSON-Schema object shape; may be empty if the preset has no inputs yet. */
	inputs_schema?: StudioInputsSchema;
};

export type StudioCatalogResponse = {
	studio_version?: string;
	engine_default?: string;
	presets?: StudioPreset[];
};

export type StudioJobRequest = {
	run_key: string;
	inputs: Record<string, unknown>;
};

/** One Comfy output image embedded by Agent Layer (no Comfy URL to browser). */
export type StudioImageObj = {
	mime: string;
	base64: string;
	data_url: string;
};

export type StudioJobResponse = {
	ok?: boolean;
	run_key?: string;
	prompt_id?: string;
	images?: StudioImageObj[];
	primary_image?: StudioImageObj | null;
	/** Legacy / optional fields */
	job_id?: string;
	status?: string;
	message?: string;
	result?: unknown;
};

export class StudioHttpError extends Error {
	readonly status: number;
	readonly body: unknown;

	constructor(message: string, status: number, body?: unknown) {
		super(message);
		this.name = 'StudioHttpError';
		this.status = status;
		this.body = body;
	}
}

/** Prefer `primary_image.data_url`, else first image with a data URL. */
export function studioResultPreviewUrl(res: StudioJobResponse): string | null {
	const p = res.primary_image;
	if (p && typeof p.data_url === 'string' && p.data_url.startsWith('data:')) return p.data_url;
	const first = res.images?.find((i) => typeof i.data_url === 'string' && i.data_url.startsWith('data:'));
	return first?.data_url ?? null;
}

function redactBase64InValue(key: string, val: unknown): unknown {
	if (key === 'base64' && typeof val === 'string') {
		return `[base64 ${val.length} chars]`;
	}
	if (key === 'data_url' && typeof val === 'string' && val.startsWith('data:')) {
		return `[data_url ${val.length} chars]`;
	}
	return val;
}

function walkRedact(obj: unknown): unknown {
	if (obj === null || obj === undefined) return obj;
	if (Array.isArray(obj)) return obj.map((x) => walkRedact(x));
	if (typeof obj !== 'object') return obj;
	const out: Record<string, unknown> = {};
	for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
		const rv = redactBase64InValue(k, v);
		out[k] = typeof rv === 'object' && rv !== null ? walkRedact(rv) : rv;
	}
	return out;
}

/** JSON for UI logs without multi-megabyte base64 payloads. */
export function summarizeStudioJobForDisplay(res: unknown): string {
	try {
		return JSON.stringify(walkRedact(res), null, 2);
	} catch {
		return String(res);
	}
}

/** Internal normalized field for Svelte form rendering. */
export type StudioFieldType =
	| 'string'
	| 'text'
	| 'number'
	| 'integer'
	| 'boolean'
	| 'enum'
	| 'image'
	| 'mask';

export type StudioFieldDef = {
	id: string;
	label?: string;
	type: StudioFieldType;
	required?: boolean;
	default?: string | number | boolean;
	enum?: string[];
	min?: number;
	max?: number;
	description?: string;
	accept?: string;
};

function propToField(id: string, prop: StudioJsonSchemaProperty, required: boolean): StudioFieldDef {
	const label = typeof prop.title === 'string' ? prop.title : id;
	const description = typeof prop.description === 'string' ? prop.description : undefined;
	const xw = prop['x-studio-widget'];

	if (prop.enum && Array.isArray(prop.enum) && prop.enum.length > 0) {
		return {
			id,
			label,
			type: 'enum',
			enum: prop.enum.map((x) => String(x)),
			required,
			default:
				prop.default === undefined || prop.default === null ? undefined : String(prop.default as string),
			description
		};
	}

	if (xw === 'image') {
		return {
			id,
			label,
			type: 'image',
			required,
			description,
			accept:
				typeof prop.contentMediaType === 'string' && prop.contentMediaType.startsWith('image/')
					? prop.contentMediaType
					: 'image/*'
		};
	}
	if (xw === 'mask') {
		return {
			id,
			label,
			type: 'mask',
			required,
			description,
			accept: 'image/png'
		};
	}

	if (prop.type === 'boolean') {
		return {
			id,
			label,
			type: 'boolean',
			required,
			default: Boolean(prop.default),
			description
		};
	}
	if (prop.type === 'integer') {
		return {
			id,
			label,
			type: 'integer',
			required,
			default: prop.default === undefined ? undefined : Number(prop.default),
			min: prop.minimum,
			max: prop.maximum,
			description
		};
	}
	if (prop.type === 'number') {
		return {
			id,
			label,
			type: 'number',
			required,
			default: prop.default === undefined ? undefined : Number(prop.default),
			min: prop.minimum,
			max: prop.maximum,
			description
		};
	}
	if (prop.type === 'string') {
		if (prop.format === 'textarea' || xw === 'textarea') {
			return {
				id,
				label,
				type: 'text',
				required,
				default: prop.default === undefined ? undefined : String(prop.default),
				description
			};
		}
		if (
			prop.format === 'data-url' ||
			prop.contentEncoding === 'base64' ||
			(typeof prop.contentMediaType === 'string' && prop.contentMediaType.startsWith('image/'))
		) {
			return {
				id,
				label,
				type: 'image',
				required,
				description,
				accept: 'image/*'
			};
		}
		if (typeof prop.maxLength === 'number' && prop.maxLength > 400) {
			return {
				id,
				label,
				type: 'text',
				required,
				default: prop.default === undefined ? undefined : String(prop.default),
				description
			};
		}
		return {
			id,
			label,
			type: 'string',
			required,
			default: prop.default === undefined ? undefined : String(prop.default),
			description
		};
	}

	return {
		id,
		label,
		type: 'string',
		required,
		default: prop.default === undefined ? undefined : String(prop.default as string),
		description
	};
}

/** Derive form fields from catalog `inputs_schema` (object with properties + required). */
export function fieldsFromInputsSchema(schema: StudioInputsSchema | undefined): StudioFieldDef[] {
	const props = schema?.properties;
	if (!props || typeof props !== 'object') return [];
	const requiredSet = new Set(
		Array.isArray(schema?.required) ? (schema.required as string[]).filter((x) => typeof x === 'string') : []
	);
	return Object.keys(props)
		.sort()
		.map((key) => propToField(key, props[key] ?? {}, requiredSet.has(key)));
}

const CHECKPOINT_FIELD_IDS = new Set(['checkpoint', 'ckpt_name']);

/**
 * Merge Comfy checkpoint filenames into schema fields (WEBUI_CONTRACT §11.1).
 * - Server may already set `enum: ["", …filenames]` on `checkpoint` / `ckpt_name`; if `enum` exists but
 *   lacks a leading `""`, it is prepended (workflow default).
 * - If those properties are plain `string` (no enum), e.g. Comfy was down during catalog build, and
 *   `checkpointFilenames` is non-empty from `GET /v1/studio/comfy/checkpoints`, upgrade to `enum`.
 */
export function applyCheckpointListToFields(
	fields: StudioFieldDef[],
	checkpointFilenames: string[]
): StudioFieldDef[] {
	const names = checkpointFilenames.map((s) => String(s).trim()).filter((s) => s.length > 0);
	if (names.length === 0) return fields;

	const withBlank = (): string[] => ['', ...names];

	return fields.map((f) => {
		if (!CHECKPOINT_FIELD_IDS.has(f.id)) return f;

		if (f.type === 'enum') {
			const en = f.enum ?? [];
			if (en.length === 0) {
				return { ...f, type: 'enum' as const, enum: withBlank(), default: f.default !== undefined ? String(f.default) : '' };
			}
			if (en[0] !== '') {
				return { ...f, enum: ['', ...en.map(String)] };
			}
			return f;
		}

		if (f.type === 'string') {
			return {
				...f,
				type: 'enum',
				enum: withBlank(),
				default: f.default !== undefined && f.default !== null ? String(f.default) : ''
			};
		}

		return f;
	});
}

function studioBase(baseUrl: string): string {
	const origin = resolveAgentLayerOrigin(baseUrl);
	return `${origin}/v1/studio`;
}

export type FetchStudioCatalogResult = {
	ok: boolean;
	presets: StudioPreset[];
	studio_version?: string;
	engine_default?: string;
	status?: number;
	error?: string;
};

export async function fetchStudioCatalog(
	baseUrl: string,
	token: string,
	extraHeaders: Record<string, string> = {}
): Promise<FetchStudioCatalogResult> {
	const url = `${studioBase(baseUrl)}/catalog`;
	const res = await fetch(url, {
		method: 'GET',
		headers: {
			Accept: 'application/json',
			...(token ? { Authorization: `Bearer ${token}` } : {}),
			...extraHeaders
		}
	});

	const text = await res.text();
	let json: unknown = null;
	try {
		json = text ? JSON.parse(text) : null;
	} catch {
		json = null;
	}

	if (!res.ok) {
		let err = text || res.statusText;
		if (json && typeof json === 'object' && json !== null && 'detail' in json) {
			const d = (json as { detail?: unknown }).detail;
			err = Array.isArray(d) ? d.map((x) => String(x)).join('; ') : String(d);
		}
		return { ok: false, presets: [], status: res.status, error: err };
	}

	const data = (json && typeof json === 'object' ? json : {}) as StudioCatalogResponse;
	const presets = Array.isArray(data.presets) ? data.presets.filter((p) => p?.run_key && p?.title) : [];

	return {
		ok: true,
		presets,
		studio_version: data.studio_version,
		engine_default: data.engine_default
	};
}

export type FetchStudioCheckpointsResult = {
	ok: boolean;
	checkpoints: string[];
	status?: number;
	error?: string;
};

/** §11.1b — ComfyUI checkpoint filenames (CheckpointLoaderSimple / ckpt_name). */
export async function fetchStudioCheckpoints(
	baseUrl: string,
	token: string,
	extraHeaders: Record<string, string> = {}
): Promise<FetchStudioCheckpointsResult> {
	const url = `${studioBase(baseUrl)}/comfy/checkpoints`;
	const res = await fetch(url, {
		method: 'GET',
		headers: {
			Accept: 'application/json',
			...(token ? { Authorization: `Bearer ${token}` } : {}),
			...extraHeaders
		}
	});

	const text = await res.text();
	let json: unknown = null;
	try {
		json = text ? JSON.parse(text) : null;
	} catch {
		json = null;
	}

	if (!res.ok) {
		let err = text || res.statusText;
		if (json && typeof json === 'object' && json !== null && 'detail' in json) {
			const d = (json as { detail?: unknown }).detail;
			err = Array.isArray(d) ? d.map((x) => String(x)).join('; ') : String(d);
		}
		return { ok: false, checkpoints: [], status: res.status, error: err };
	}

	const data = (json && typeof json === 'object' ? json : {}) as { checkpoints?: unknown };
	const raw = data.checkpoints;
	const checkpoints = Array.isArray(raw)
		? raw.filter((x): x is string => typeof x === 'string' && x.length > 0)
		: [];

	return { ok: true, checkpoints };
}

export async function createStudioJob(
	baseUrl: string,
	token: string,
	body: StudioJobRequest,
	extraHeaders: Record<string, string> = {}
): Promise<StudioJobResponse> {
	const url = `${studioBase(baseUrl)}/jobs`;
	const res = await fetch(url, {
		method: 'POST',
		headers: {
			Accept: 'application/json',
			'Content-Type': 'application/json',
			...(token ? { Authorization: `Bearer ${token}` } : {}),
			...extraHeaders
		},
		body: JSON.stringify(body)
	});

	const text = await res.text();
	let json: unknown = null;
	try {
		json = text ? JSON.parse(text) : null;
	} catch {
		json = null;
	}

	if (!res.ok) {
		let err = text || res.statusText;
		if (json && typeof json === 'object' && json !== null && 'detail' in json) {
			const d = (json as { detail?: unknown }).detail;
			err = Array.isArray(d) ? d.map((x) => String(x)).join('; ') : String(d);
		}
		throw new StudioHttpError(err || `HTTP ${res.status}`, res.status, json);
	}

	return (json && typeof json === 'object' ? json : {}) as StudioJobResponse;
}
