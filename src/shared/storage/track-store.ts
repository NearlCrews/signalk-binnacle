import { degradeToMemory, openIdbStore } from './idb';

// A small append log generic over the record type so this stays domain-free (the track point
// shape lives in entities/track). It degrades to an in-memory log, and never throws, when
// IndexedDB is missing (Node, private mode) or fails to open or write (blocked upgrade, quota,
// corruption), so a persistence failure never breaks recording.

export interface TrackStore<T> {
  all(): Promise<T[]>;
  append(item: T): Promise<void>;
  clear(): Promise<void>;
}

const DB_NAME = 'binnacle';
const STORE = 'track-points';

// The in-RAM fallback log. degradeToMemory mirrors every write here so a mid-session IndexedDB
// degrade keeps recent history, but with IndexedDB healthy that mirror is never read and would grow
// for the whole session, so the redundant mirror is bounded to a recent window. The no-IndexedDB
// primary store (Node, private mode) passes no cap, since it is the only copy of the track.
const MEMORY_MIRROR_CAP = 20_000;

function memoryStore<T>(cap = Number.POSITIVE_INFINITY): TrackStore<T> {
  let items: T[] = [];
  return {
    all: async () => items.slice(),
    append: async (item) => {
      items.push(item);
      if (items.length > cap) items.splice(0, items.length - cap);
    },
    clear: async () => {
      items = [];
    },
  };
}

export function createTrackStore<T>(
  factory: IDBFactory | undefined = globalThis.indexedDB,
  onDegrade?: () => void,
): TrackStore<T> {
  if (!factory) {
    onDegrade?.();
    return memoryStore<T>();
  }

  const memory = memoryStore<T>(MEMORY_MIRROR_CAP);
  const { run } = openIdbStore(factory, DB_NAME, STORE, (db) =>
    db.createObjectStore(STORE, { autoIncrement: true }),
  );
  // Observable rather than silent: a track-recording IDB failure (quota, blocked upgrade,
  // corruption) stops the boat's track surviving reloads, which a field report needs to diagnose.
  const idb = degradeToMemory(() => {
    console.warn(`Track persistence "${DB_NAME}" degraded to memory for this session.`);
    onDegrade?.();
  });

  return {
    all: () =>
      idb.read<T[]>(
        () => run<T[]>('readonly', (s) => s.getAll()),
        () => memory.all(),
      ),
    append: (item) =>
      idb.write(
        () => run('readwrite', (s) => s.add(item)),
        () => memory.append(item),
      ),
    clear: () =>
      idb.write(
        () => run('readwrite', (s) => s.clear()),
        () => memory.clear(),
      ),
  };
}
