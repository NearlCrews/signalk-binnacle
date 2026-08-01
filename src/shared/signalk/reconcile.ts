import { isRecord } from '$shared/lib';
import {
  type Context,
  type Delta,
  type Path,
  type PathSource,
  type PathValue,
  SELF_CONTEXT,
  type Value,
} from './types';

const MAX_DELTA_UPDATES = 1_024;
export const MAX_VALUES_PER_UPDATE = 2_048;
const MAX_VALUES_PER_DELTA = 8_192;
const MAX_CONTEXT_LENGTH = 512;
const MAX_PATH_LENGTH = 512;
const MAX_SOURCE_LABEL_LENGTH = 256;

function boundedText(value: unknown, maximum: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > maximum) return undefined;
  for (let index = 0; index < trimmed.length; index += 1) {
    const code = trimmed.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f) return undefined;
  }
  return trimmed;
}

export function cleanContext(value: unknown): Context | undefined {
  return boundedText(value, MAX_CONTEXT_LENGTH);
}

function sourceLabel(source: unknown): string | undefined {
  const direct = boundedText(source, MAX_SOURCE_LABEL_LENGTH);
  if (direct) return direct;
  if (!isRecord(source)) return undefined;
  const label = boundedText(source.label, MAX_SOURCE_LABEL_LENGTH);
  if (label) return label;
  const type = boundedText(source.type, 64);
  const src = source.src;
  const pgn = source.pgn;
  const sourceId =
    typeof src === 'number' && Number.isFinite(src) ? String(src) : boundedText(src, 128);
  const pgnId =
    typeof pgn === 'number' && Number.isFinite(pgn) ? String(pgn) : boundedText(pgn, 128);
  if (type && sourceId) return `${type} ${sourceId}`.slice(0, MAX_SOURCE_LABEL_LENGTH);
  if (sourceId) return `Source ${sourceId}`.slice(0, MAX_SOURCE_LABEL_LENGTH);
  if (pgnId) return `PGN ${pgnId}`.slice(0, MAX_SOURCE_LABEL_LENGTH);
  return undefined;
}

// The hottest path in the app: positional arguments, not a per-value object, so reconciling a
// delta allocates nothing per leaf.
export function reconcileDelta(
  delta: Delta,
  onLeaf: (context: Context, path: Path, value: Value, source?: PathSource) => void,
): void {
  if (!isRecord(delta)) return;
  const context = delta.context === undefined ? SELF_CONTEXT : cleanContext(delta.context);
  if (!context || !Array.isArray(delta.updates) || delta.updates.length > MAX_DELTA_UPDATES) return;
  let accepted = 0;
  for (const update of delta.updates) {
    if (!isRecord(update)) continue;
    const values: PathValue[] | undefined = update.values;
    if (!Array.isArray(values) || values.length > MAX_VALUES_PER_UPDATE) continue;
    const label = sourceLabel(update.source);
    const source: PathSource | undefined = label ? { label } : undefined;
    for (const pv of values) {
      // A malformed element (null, or a missing or non-string path) would key the frame Map with a
      // non-string and throw in applyFrame's path.startsWith, aborting the whole frame's update.
      if (!isRecord(pv)) continue;
      const path = boundedText(pv.path, MAX_PATH_LENGTH);
      if (!path) continue;
      if (accepted >= MAX_VALUES_PER_DELTA) return;
      accepted += 1;
      onLeaf(context, path, pv.value as Value, source);
    }
  }
}
