// The automatic «Напоминания» open after a dictated reminder (stage 7, A11): ONE pending open at a time, with a
// countdown «Ставлю напоминание через 5…». Cancelled by «Не надо», a manual tap on «Поставить напоминание»,
// «Отменить», «Изменить», «Удалить» and a newer phrase, so a reminder is never set twice.

export interface AutoOpenOptions {
  seconds: number;
  /** Seconds left (seconds … 1) while pending; null once it fired or was cancelled. */
  onTick: (left: number | null) => void;
  onFire: () => void;
}

let pending: { timer: ReturnType<typeof setInterval>; left: number; onTick: AutoOpenOptions['onTick'] } | null = null;

export const autoOpenLeft = (): number | null => pending?.left ?? null;

export function cancelAutoOpen(): void {
  if (!pending) return;
  const { timer, onTick } = pending;
  clearInterval(timer);
  pending = null;
  onTick(null);
}

export function scheduleAutoOpen(opts: AutoOpenOptions): void {
  cancelAutoOpen();
  const timer = setInterval(() => {
    if (!pending || pending.timer !== timer) return;
    pending.left -= 1;
    if (pending.left > 0) {
      opts.onTick(pending.left);
      return;
    }
    clearInterval(timer);
    pending = null;
    opts.onTick(null);
    opts.onFire();
  }, 1000);
  pending = { timer, left: opts.seconds, onTick: opts.onTick };
  opts.onTick(opts.seconds);
}
