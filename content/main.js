(async function () {
  'use strict';
  const YTPS = globalThis.YTPS;
  if (YTPS.started) return;
  YTPS.started = true;

  const DEFAULTS = {
    semitones: 0, cents: 0, quality: 'normal',
    eq: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    gainDb: 0, compressor: false, autoLevel: false, targetLufs: -14,
    vocalMode: 'off', vocalStrength: 1, vocalLowHz: 150, vocalHighHz: 8000,
    bypass: false, panelPos: null, collapsed: {},
  };

  const stored = (await browser.storage.local.get('settings')).settings || {};
  const settings = Object.assign({}, DEFAULTS, stored);
  if (!Array.isArray(settings.eq) || settings.eq.length !== 10) settings.eq = DEFAULTS.eq.slice();

  const engine = new YTPS.AudioEngine();
  let panel = null;

  const isNeutral = (s) => s.bypass || (s.semitones === 0 && s.cents === 0 && s.eq.every((g) => g === 0) &&
    s.gainDb === 0 && !s.compressor && !s.autoLevel && s.vocalMode === 'off');
  const videos = () => Array.from(document.querySelectorAll('video'));

  // The engine (and capture of the video) only starts when it is actually needed:
  // a non-neutral setting, or the panel being open for the analyser.
  function maybeStart() {
    if (!engine.ready && isNeutral(settings) && !(panel && panel.visible)) return;
    engine.init().then(() => {
      engine.apply(settings);
      engine.attach(videos());
    }).catch((e) => { engine.error = 'Audio engine failed: ' + e.message; });
  }

  let saveTimer = 0, lastSaved = JSON.stringify(settings);
  function update(patch) {
    Object.assign(settings, patch);
    if (engine.ctx) engine.apply(settings);
    maybeStart();
    if (panel) panel.sync();
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      lastSaved = JSON.stringify(settings);
      browser.storage.local.set({ settings: JSON.parse(lastSaved) });
    }, 250);
  }

  function getPanel() {
    if (!panel) panel = new YTPS.Panel({ settings, engine, update, onShow: maybeStart });
    return panel;
  }

  // Keep other YouTube tabs in sync
  browser.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes.settings || !changes.settings.newValue) return;
    const nv = JSON.stringify(changes.settings.newValue);
    if (nv === lastSaved || nv === JSON.stringify(settings)) return;
    lastSaved = nv;
    Object.assign(settings, changes.settings.newValue);
    if (engine.ctx) engine.apply(settings);
    maybeStart();
    if (panel) panel.sync();
  });

  browser.runtime.onMessage.addListener((msg) => {
    if (!msg) return;
    if (msg.type === 'toggle-panel') getPanel().toggle();
    if (msg.type === 'command') {
      const p = getPanel();
      const clamp = (v) => Math.max(-12, Math.min(12, v));
      if (msg.name === 'toggle-panel') return p.toggle();
      if (msg.name === 'pitch-up') update({ semitones: clamp(settings.semitones + 1) });
      if (msg.name === 'pitch-down') update({ semitones: clamp(settings.semitones - 1) });
      if (msg.name === 'pitch-reset') update({ semitones: 0, cents: 0 });
      if (msg.name === 'vocal-toggle') {
        update({ vocalMode: settings.vocalMode === 'remove' ? 'off' : 'remove' });
        if (!p.visible) p.toast(settings.vocalMode === 'remove' ? 'Vocals removed' : 'Vocals restored');
        return;
      }
      if (!p.visible) {
        const n = settings.semitones;
        p.toast(`Pitch ${n > 0 ? '+' : n < 0 ? '−' : '±'}${Math.abs(n)} st`);
      }
    }
  });

  // YouTube is a single-page app and Shorts swap <video> elements: keep looking.
  setInterval(() => { if (engine.ctx) engine.attach(videos()); }, 1000);
  document.addEventListener('yt-navigate-finish', () => { if (engine.ctx) engine.attach(videos()); });
  document.addEventListener('fullscreenchange', () => { if (panel) panel.mount(); });

  maybeStart();
})();
