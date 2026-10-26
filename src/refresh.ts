// Overlapping refreshes (a save, a model answer, an edit) finish in any order: only the newest one may draw,
// otherwise an older read of the database overwrites what the newer one showed («Последняя запись» vanished).

/** `load` reads, `apply` draws. A call whose read is no longer the newest draws nothing and waits for the newest one. */
export function latestOnly<T>(load: () => Promise<T>, apply: (data: T) => void): () => Promise<void> {
  let generation = 0;
  let newest: Promise<void> = Promise.resolve();
  return () => {
    const mine = ++generation;
    newest = (async () => {
      const data = await load();
      if (mine !== generation) return newest;
      apply(data);
    })();
    return newest;
  };
}
