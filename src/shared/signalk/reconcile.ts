import {
  type Context,
  type Delta,
  type Path,
  type PathSource,
  type PathValue,
  SELF_CONTEXT,
  type Value,
} from './types';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function sourceLabel(source: unknown): string | undefined {
  if (typeof source === 'string' && source.trim()) return source;
  if (!isRecord(source)) return undefined;
  const label = source.label;
  if (typeof label === 'string' && label.trim()) return label;
  const type = source.type;
  const src = source.src;
  const pgn = source.pgn;
  if (typeof type === 'string' && typeof src === 'number') return `${type} ${src}`;
  if (typeof src === 'number' || typeof src === 'string') return `Source ${src}`;
  if (typeof pgn === 'number' || typeof pgn === 'string') return `PGN ${pgn}`;
  return undefined;
}

// The hottest path in the app: positional arguments, not a per-value object, so reconciling a
// delta allocates nothing per leaf.
export function reconcileDelta(
  delta: Delta,
  onLeaf: (context: Context, path: Path, value: Value, source?: PathSource) => void,
): void {
  const context = delta.context ?? SELF_CONTEXT;
  for (const update of delta.updates ?? []) {
    const values: PathValue[] | undefined = update.values;
    if (!Array.isArray(values)) continue;
    const label = sourceLabel(update.source);
    const source: PathSource | undefined = label ? { label } : undefined;
    for (const pv of values) {
      // A malformed element (null, or a missing or non-string path) would key the frame Map with a
      // non-string and throw in applyFrame's path.startsWith, aborting the whole frame's update.
      if (!pv || typeof pv.path !== 'string') continue;
      onLeaf(context, pv.path, pv.value, source);
    }
  }
}
