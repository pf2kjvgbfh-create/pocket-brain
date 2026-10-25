// «Настройки»: the GitHub copy block, the local model block («Умный разбор») + version.
import { APP_VERSION } from '../config';
import type { BackupController } from '../backup/runner';
import type { App } from './app';
import { renderBackupPanel } from './backup-panel';
import { h } from './dom';

export function renderSettings(root: HTMLElement, app: App, backup: BackupController, modelPanel: HTMLElement): void {
  root.replaceChildren(
    h('h1', {}, 'Настройки'),
    renderBackupPanel(app, backup),
    modelPanel,
    h('p', { class: 'hint', 'data-testid': 'version' }, `Версия ${APP_VERSION}`),
  );
}
