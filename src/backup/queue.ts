// Single flight + coalescing: at most ONE run at a time; requests during a run cause exactly one follow-up run.

export interface SingleFlight {
  /** Ask for a run. Never throws, never waits. */
  request: () => void;
  /** Resolves when nothing is running and nothing is pending. */
  idle: () => Promise<void>;
}

export function createSingleFlight(run: () => Promise<void>): SingleFlight {
  let running: Promise<void> | null = null;
  let dirty = false;

  const loop = async (): Promise<void> => {
    do {
      dirty = false;
      try {
        await run();
      } catch {
        // A failed run is reported by `run` itself; the queue must stay usable.
      }
    } while (dirty);
  };

  return {
    request: () => {
      if (running) {
        dirty = true;
        return;
      }
      running = loop().finally(() => {
        running = null;
      });
    },
    idle: async () => {
      while (running) await running;
    },
  };
}
