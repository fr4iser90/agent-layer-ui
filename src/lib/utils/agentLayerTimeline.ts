/** One server frame stored for Agent Layer WebSocket timeline UI (§4.3). */
export type AgentLayerTimelineEntry = {
	type: string;
	at: number;
	payload: Record<string, unknown>;
};

/** UI bucket for styling (maps agent.* frames, not backend-specific “thought” types). */
export type AgentTimelineKind =
	| 'session'
	| 'thinking'
	| 'tool'
	| 'tool_done'
	| 'wait'
	| 'done'
	| 'other';

export function classifyAgentTimelineType(type: string): AgentTimelineKind {
	const t = typeof type === 'string' ? type : String(type ?? '');
	if (t === 'agent.session' || t === 'agent_session') return 'session';
	if (
		t === 'agent.llm_round' ||
		t === 'agent_llm_round' ||
		t === 'agent.llm.round' ||
		t === 'agent.llm_round_start' ||
		t === 'agent_llm_round_start'
	) {
		return 'thinking';
	}
	if (t === 'agent.tool_start' || t === 'agent_tool_start') return 'tool';
	if (t === 'agent.tool_done' || t === 'agent_tool_done') return 'tool_done';
	if (t === 'agent.step_wait' || t === 'agent_step_wait') return 'wait';
	if (t === 'agent.done' || t === 'agent_done') return 'done';
	return 'other';
}

function extractPayloadData(payload: Record<string, unknown>): Record<string, unknown> {
	if (payload.data && typeof payload.data === 'object') {
		return payload.data as Record<string, unknown>;
	}
	return payload;
}

export function toolNameFromTimelineEntry(e: AgentLayerTimelineEntry): string | undefined {
	const d = extractPayloadData(e.payload);
	const raw = [d.name, d.tool, d.tool_name].find((v) => typeof v === 'string' && v.trim().length > 0);
	if (typeof raw !== 'string') {
		const n = d.tool;
		if (typeof n === 'number' && !Number.isNaN(n)) return String(n);
		return undefined;
	}
	return raw.trim();
}

/** Split timeline into segments: preamble, then each `agent.llm_round_start` begins a new segment. */
export function segmentAgentTimelineByRound(entries: AgentLayerTimelineEntry[]): AgentLayerTimelineEntry[][] {
	if (entries.length === 0) return [];
	const segments: AgentLayerTimelineEntry[][] = [];
	let current: AgentLayerTimelineEntry[] = [];

	for (const e of entries) {
		const et = typeof e.type === 'string' ? e.type : String(e.type ?? '');
		const isRoundStart =
			et === 'agent.llm_round_start' || et === 'agent_llm_round_start';
		if (isRoundStart && current.length > 0) {
			segments.push(current);
			current = [e];
		} else {
			current.push(e);
		}
	}
	if (current.length) segments.push(current);
	return segments.length ? segments : [entries];
}

/** Ordered rows: non-tool frames interleaved; tool_start + tool_done merged by tool name when possible. */
export type TimelineDisplayRow =
	| { kind: 'frame'; entry: AgentLayerTimelineEntry }
	| { kind: 'tool_pair'; name: string; start?: AgentLayerTimelineEntry; done?: AgentLayerTimelineEntry };

export function linearizeSegmentForDisplay(segment: AgentLayerTimelineEntry[]): TimelineDisplayRow[] {
	const out: TimelineDisplayRow[] = [];
	const openByName = new Map<
		string,
		{ kind: 'tool_pair'; name: string; start?: AgentLayerTimelineEntry; done?: AgentLayerTimelineEntry }
	>();

	for (const e of segment) {
		const ct = classifyAgentTimelineType(e.type);
		const name = toolNameFromTimelineEntry(e);

		if (ct === 'tool') {
			if (name) {
				let row = openByName.get(name);
				if (!row) {
					row = { kind: 'tool_pair', name, start: e };
					openByName.set(name, row);
					out.push(row);
				} else {
					row.start = e;
				}
			} else {
				out.push({ kind: 'tool_pair', name: 'tool', start: e });
			}
			continue;
		}
		if (ct === 'tool_done') {
			if (name && openByName.has(name)) {
				const row = openByName.get(name)!;
				row.done = e;
				openByName.delete(name);
			} else {
				out.push({ kind: 'tool_pair', name: name ?? 'tool', done: e });
			}
			continue;
		}
		out.push({ kind: 'frame', entry: e });
	}
	return out;
}

export function countTimelineStats(entries: AgentLayerTimelineEntry[]): {
	frames: number;
	segments: number;
	toolPairs: number;
} {
	const segments = segmentAgentTimelineByRound(entries);
	let toolPairs = 0;
	for (const seg of segments) {
		for (const row of linearizeSegmentForDisplay(seg)) {
			if (row.kind === 'tool_pair') toolPairs++;
		}
	}
	return { frames: entries.length, segments: segments.length, toolPairs };
}

const SKIP_TIMELINE = new Set([
	'pong',
	'error',
	'chat.completion',
	'chat_completion',
	'agent.aborted',
	'agent.cancelled',
	'agent_aborted',
	'agent_cancelled'
]);

/** Whether this frame should appear in the per-message timeline (not the final completion). */
export function shouldRecordAgentLayerTimelineFrame(type: string | undefined): boolean {
	if (!type) return false;
	if (SKIP_TIMELINE.has(type)) return false;
	if (type.startsWith('agent.')) return true;
	if (
		type.startsWith('agent_') &&
		type !== 'agent_aborted' &&
		type !== 'agent_cancelled'
	) {
		return true;
	}
	return false;
}

function pickStr(v: unknown): string | undefined {
	return typeof v === 'string' && v.trim() ? v : undefined;
}

function pickNum(v: unknown): number | undefined {
	return typeof v === 'number' && !Number.isNaN(v) ? v : undefined;
}

/** One-line summary for the timeline row (best-effort across backend shapes). */
export function summarizeAgentLayerTimelineEntry(e: AgentLayerTimelineEntry): string {
	const p = e.payload;
	const data =
		p.data && typeof p.data === 'object' ? (p.data as Record<string, unknown>) : p;

	const parts: string[] = [];

	const tools = data.forwarded_tools;
	if (Array.isArray(tools) && tools.length)
		parts.push(`${tools.length} tools: ${tools.slice(0, 8).join(', ')}${tools.length > 8 ? '…' : ''}`);

	const cat = pickStr(data.routed_category);
	if (cat) parts.push(`route: ${cat}`);

	const rc = data.router_categories;
	if (Array.isArray(rc) && rc.length) parts.push(`categories: ${rc.join(', ')}`);

	const round = pickNum(data.round) ?? pickNum(data.round_index);
	if (round !== undefined) parts.push(`round ${round}`);

	const excerpt = pickStr(data.content_excerpt) ?? pickStr(data.excerpt);
	if (excerpt) parts.push(excerpt.slice(0, 120) + (excerpt.length > 120 ? '…' : ''));

	const name =
		pickStr(data.name) ??
		pickStr(data.tool) ??
		pickStr((data.tool_name as string) || undefined);
	if (name) parts.push(name);

	const rcChars = pickNum(data.result_chars);
	if (rcChars !== undefined) parts.push(`${rcChars} chars`);

	const tc = data.tool_calls;
	if (Array.isArray(tc) && tc.length) parts.push(`${tc.length} tool call(s)`);

	const reason = pickStr(data.reason) ?? pickStr(data.state);
	if (reason) parts.push(reason);

	if (parts.length === 0) {
		try {
			const s = JSON.stringify(data);
			return s.length > 180 ? `${s.slice(0, 180)}…` : s;
		} catch {
			return '';
		}
	}
	return parts.join(' · ');
}
