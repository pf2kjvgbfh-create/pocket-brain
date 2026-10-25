// «Настройки»: the GitHub copy block + version.
import { APP_VERSION } from '../config';
import type { BackupController } from '../backup/runner';
import type { App } from './app';
import { renderBackupPanel } from './backup-panel';
import { h } from './dom';

export function renderSettings(root: HTMLElement, app: App, backup: BackupController): void {
  root.replaceChildren(
    h('h1', {}, 'Настройки'),
    renderBackupPanel(app, backup),
    h('p', { class: 'hint', 'data-testid': 'version' }, `Версия ${APP_VERSION}`),
  );
}
