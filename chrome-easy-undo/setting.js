const DEFAULTS = {
  maxStored: 300,
  popupWidth: 380,
  showFavicon: true,
  showUrl: true,
  showTime: true,
  showBadge: true,
  caseSensitive: false,
  closeOnRestore: false,
  searchScope: 'title',
  theme: 'auto',
  blockedUrls: [],
};

async function loadSettings() {
  const r = await chrome.storage.local.get('settings');
  return { ...DEFAULTS, ...(r.settings || {}) };
}

async function saveSettings(s) {
  await chrome.storage.local.set({ settings: s });
  chrome.runtime.sendMessage({ type: 'updateBadge' }).catch(() => {});
}

async function getClosedTabs() {
  const r = await chrome.storage.local.get('closedTabs');
  return r.closedTabs || [];
}

async function setClosedTabs(list) {
  await chrome.storage.local.set({ closedTabs: list });
  chrome.runtime.sendMessage({ type: 'updateBadge' }).catch(() => {});
}

// toggle
function setToggle(id, val) {
  const el = document.getElementById(id);
  el.classList.toggle('on', !!val);
  el.dataset.val = val ? '1' : '0';
}
function getToggle(id) {
  return document.getElementById(id).dataset.val === '1';
}

// seg
function setSeg(segId, val) {
  document.querySelectorAll(`#${segId} .seg-btn`).forEach(btn => {
    btn.classList.toggle('active', btn.dataset.value === val);
  });
}
function getSeg(segId) {
  const active = document.querySelector(`#${segId} .seg-btn.active`);
  return active ? active.dataset.value : null;
}

// slider
function initSlider(id, valId, settings, key) {
  const slider = document.getElementById(id);
  const label = document.getElementById(valId);
  slider.value = settings[key];
  label.textContent = settings[key];
  slider.addEventListener('input', () => { label.textContent = slider.value; });
}

// blocked urls
let blockedUrls = [];

function renderBlockedList() {
  const list = document.getElementById('blockedList');
  list.innerHTML = '';
  blockedUrls.forEach((url, i) => {
    const tag = document.createElement('div');
    tag.className = 'blocked-tag';
    tag.textContent = url;
    const rm = document.createElement('button');
    rm.className = 'blocked-tag-remove';
    rm.textContent = '×';
    rm.title = '移除';
    rm.addEventListener('click', () => {
      blockedUrls.splice(i, 1);
      renderBlockedList();
    });
    tag.appendChild(rm);
    list.appendChild(tag);
  });
}

function showTip(id, msg) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = msg;
  el.style.opacity = '1';
  setTimeout(() => { el.style.opacity = '0'; }, 2000);
}

async function init() {
  const settings = await loadSettings();
  blockedUrls = [...(settings.blockedUrls || [])];

  initSlider('popupWidth', 'popupWidthVal', settings, 'popupWidth');
  initSlider('maxStored', 'maxStoredVal', settings, 'maxStored');

  setToggle('showTime', settings.showTime);
  setToggle('showFavicon', settings.showFavicon);
  setToggle('showUrl', settings.showUrl);
  setToggle('showBadge', settings.showBadge);
  setToggle('caseSensitive', settings.caseSensitive);
  setToggle('closeOnRestore', settings.closeOnRestore);

  setSeg('themeSeg', settings.theme);
  setSeg('searchScopeSeg', settings.searchScope);

  renderBlockedList();

  // toggles
  ['showTime', 'showFavicon', 'showUrl', 'showBadge', 'caseSensitive', 'closeOnRestore'].forEach(id => {
    document.getElementById(id).addEventListener('click', () => setToggle(id, !getToggle(id)));
  });

  // seg clicks
  document.querySelectorAll('.seg-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const seg = btn.closest('.seg');
      seg.querySelectorAll('.seg-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });

  // clear days slider
  const clearDaysSlider = document.getElementById('clearDays');
  const clearDaysLabel = document.getElementById('clearDaysLabel');
  const clearDaysBtn = document.getElementById('clearDaysBtn');
  clearDaysSlider.addEventListener('input', () => {
    clearDaysLabel.textContent = clearDaysSlider.value;
    clearDaysBtn.textContent = clearDaysSlider.value;
  });

  // clear all
  document.getElementById('clearAll').addEventListener('click', async () => {
    await setClosedTabs([]);
    showTip('clearAllTip', '已清空');
  });

  // clear by days
  document.getElementById('clearByDays').addEventListener('click', async () => {
    const days = parseInt(clearDaysSlider.value, 10);
    const cutoff = Date.now() - days * 86400_000;
    const list = await getClosedTabs();
    const kept = list.filter(t => t.closedAt >= cutoff);
    await setClosedTabs(kept);
    showTip('clearByDaysTip', `已清理 ${days} 天前的记录`);
  });

  // shortcuts
  document.getElementById('openShortcuts').addEventListener('click', () => {
    chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
  });

  // blocked url
  document.getElementById('addBlockedUrl').addEventListener('click', () => {
    document.getElementById('blockedInputWrap').style.display = 'flex';
    document.getElementById('blockedUrlInput').focus();
  });

  document.getElementById('confirmBlockedUrl').addEventListener('click', () => {
    const val = document.getElementById('blockedUrlInput').value.trim();
    if (val && !blockedUrls.includes(val)) {
      blockedUrls.push(val);
      renderBlockedList();
    }
    document.getElementById('blockedUrlInput').value = '';
    document.getElementById('blockedInputWrap').style.display = 'none';
  });

  document.getElementById('cancelBlockedUrl').addEventListener('click', () => {
    document.getElementById('blockedUrlInput').value = '';
    document.getElementById('blockedInputWrap').style.display = 'none';
  });

  document.getElementById('blockedUrlInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') document.getElementById('confirmBlockedUrl').click();
    if (e.key === 'Escape') document.getElementById('cancelBlockedUrl').click();
  });

  // reset
  document.getElementById('resetAll').addEventListener('click', async () => {
    await saveSettings(DEFAULTS);
    blockedUrls = [...(DEFAULTS.blockedUrls || [])];
    await init();
    showTip('resetTip', '已恢复默认');
  });

  // save
  document.getElementById('save').addEventListener('click', async () => {
    const s = {
      maxStored: parseInt(document.getElementById('maxStored').value, 10),
      popupWidth: parseInt(document.getElementById('popupWidth').value, 10),
      showTime: getToggle('showTime'),
      showFavicon: getToggle('showFavicon'),
      showUrl: getToggle('showUrl'),
      showBadge: getToggle('showBadge'),
      caseSensitive: getToggle('caseSensitive'),
      closeOnRestore: getToggle('closeOnRestore'),
      theme: getSeg('themeSeg') || DEFAULTS.theme,
      searchScope: getSeg('searchScopeSeg') || DEFAULTS.searchScope,
      blockedUrls: [...blockedUrls],
    };
    await saveSettings(s);
    const tip = document.getElementById('saveTip');
    tip.textContent = '保存成功';
    // 重播动画：先移除再强制 reflow，否则连续点击不会重新触发
    tip.classList.remove('rise');
    void tip.offsetWidth;
    tip.classList.add('rise');
  });
}

init();
