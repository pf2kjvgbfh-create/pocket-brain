// App shell for stage 0: tab switching and service worker registration. No business logic yet.

const tabs = Array.from(document.querySelectorAll<HTMLButtonElement>('.tabbar button'));
const screens = Array.from(document.querySelectorAll<HTMLElement>('.screen'));

function showTab(name: string): void {
  for (const s of screens) s.hidden = s.dataset.tab !== name;
  for (const t of tabs) t.setAttribute('aria-selected', String(t.dataset.tab === name));
}

for (const t of tabs) {
  t.addEventListener('click', () => showTab(t.dataset.tab ?? 'new'));
}

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  const base = import.meta.env.BASE_URL;
  navigator.serviceWorker.register(`${base}sw.js`, { scope: base }).catch((err: unknown) => {
    console.warn('service worker registration failed', err);
  });
}
