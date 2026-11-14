// app.js — bootstrap: loads state, registers the service worker, routes between screens.
import { S, loadState } from './state.js';
import { setLang, t } from './i18n.js';
import { setAudioPrefs, unlockAudio, sfx } from './audio.js';
import { h, toast } from './ui.js';
import { renderHome } from './screens/home.js';
import { renderFight } from './screens/fight.js';
import { renderQuests } from './screens/quests.js';
import { renderStats } from './screens/stats.js';
import { renderSettings, renderWelcome } from './screens/settings.js';

// To add a mini-game: write js/screens/<name>.js exporting render(root, params, nav) and register it here.
const SCREENS = { home: renderHome, fight: renderFight, quests: renderQuests, stats: renderStats, settings: renderSettings, welcome: renderWelcome };
const TABS = [['home', '🗺️', 'nav.map'], ['quests', '📜', 'nav.quests'], ['stats', '📊', 'nav.stats'], ['settings', '⚙️', 'nav.settings']];

const root = document.getElementById('screen'), navEl = document.getElementById('nav');
let cleanup = null, current = null, installEvent = null, swReady = false;

const nav = {
  go(name, params = {}) {
    if (!S.entries.length && name !== 'settings' && name !== 'welcome') name = 'welcome';
    if (typeof cleanup === 'function') { try { cleanup(); } catch (e) { console.warn(e); } }
    cleanup = null; current = name;
    document.body.dataset.screen = name;
    root.scrollTop = 0; window.scrollTo(0, 0);
    try { cleanup = SCREENS[name](root, params, nav) || null; }
    catch (err) { console.error(err); root.replaceChildren(h('section', { class: 'page' }, h('h1', null, 'Oops'), h('p', null, String(err.message || err)), h('button', { class: 'btn primary', onclick: () => nav.go('home') }, 'OK'))); }
    drawNav();
  },
  canInstall: () => !!installEvent,
  async install() { if (!installEvent) return; installEvent.prompt(); await installEvent.userChoice.catch(() => {}); installEvent = null; nav.go('settings'); },
  swReady: () => swReady
};
function drawNav() {
  navEl.hidden = current === 'fight' || current === 'welcome';
  navEl.replaceChildren(...TABS.map(([name, icon, key]) => h('button', { type: 'button', class: name === current ? 'on' : '', 'aria-current': name === current ? 'page' : null,
    onclick: () => { sfx.click(); nav.go(name); } }, h('span', { class: 'nav-ico', 'aria-hidden': 'true' }, icon), h('span', null, t(key)))));
}

async function boot() {
  try { await loadState(); }
  catch (err) { console.error(err); root.replaceChildren(h('section', { class: 'page' }, h('h1', null, 'Wortboss'), h('p', null, 'Could not open the local database: ' + (err.message || err)))); return; }
  setLang(S.settings.lang); setAudioPrefs(S.settings);
  document.addEventListener('pointerdown', unlockAudio, { once: true });
  document.addEventListener('keydown', unlockAudio, { once: true });
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEvent = e; if (current === 'settings') nav.go('settings'); });
  window.addEventListener('appinstalled', () => { installEvent = null; toast(t('settings.installed')); });
  document.getElementById('boot')?.remove();
  nav.go(S.entries.length ? 'home' : 'welcome');
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    try {
      const reg = await navigator.serviceWorker.register('sw.js');
      swReady = !!(reg.active || reg.waiting || reg.installing);
      navigator.serviceWorker.addEventListener('controllerchange', () => { swReady = true; });
    } catch (err) { console.warn('service worker not registered', err); }
  }
}
window.wortboss = { S, nav };      // handy in the browser console and for future mini-games
boot();
