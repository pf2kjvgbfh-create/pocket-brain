// «Настройки»: skeleton only for now (heading + version).
import { APP_VERSION } from '../config';
import { h } from './dom';

export function renderSettings(root: HTMLElement): void {
  root.replaceChildren(h('h1', {}, 'Настройки'), h('p', { class: 'hint', 'data-testid': 'version' }, `Версия ${APP_VERSION}`));
}
