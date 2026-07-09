const FAV_FALLBACK =
  'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16">' +
  '<rect width="16" height="16" rx="2" fill="%23e2e8f0"/>' +
  '<text x="8" y="12" text-anchor="middle" font-size="10" fill="%2394a3b8">○</text></svg>';

const DEFAULTS = {
  maxStored: 300,
  popupWidth: 380,
  popupHeight: 400,
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

async function getSettings() {
  const r = await chrome.storage.local.get('settings');
  return { ...DEFAULTS, ...(r.settings || {}) };
}

async function getClosedTabs() {
  const r = await chrome.storage.local.get('closedTabs');
  return r.closedTabs || [];
}

async function removeClosedTab(id) {
  const list = await getClosedTabs();
  const next = list.filter(t => t.id !== id);
  await chrome.storage.local.set({ closedTabs: next });
  chrome.runtime.sendMessage({ type: 'updateBadge' }).catch(() => {});
}

function formatTime(ts) {
  const diff = Date.now() - ts;
  if (diff < 60_000) return '刚刚';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  return `${Math.floor(diff / 86_400_000)} 天前`;
}

function applyTheme(theme) {
  if (theme === 'dark') document.documentElement.setAttribute('data-theme', 'dark');
  else if (theme === 'light') document.documentElement.setAttribute('data-theme', 'light');
  else document.documentElement.removeAttribute('data-theme');
}

function matches(tab, query, settings) {
  if (!query) return true;
  const q = settings.caseSensitive ? query : query.toLowerCase();
  const scope = settings.searchScope || 'title';
  const title = settings.caseSensitive ? tab.title : tab.title.toLowerCase();
  const url = settings.caseSensitive ? tab.url : tab.url.toLowerCase();
  if (scope === 'title') return title.includes(q);
  if (scope === 'url') return url.includes(q);
  return title.includes(q) || url.includes(q);
}

function createTabItem(tab, settings, onRemove) {
  const item = document.createElement('div');
  item.className = 'tab-item';

  if (settings.showFavicon) {
    const fav = document.createElement('img');
    fav.className = 'favicon';
    fav.src = tab.favIconUrl || FAV_FALLBACK;
    fav.onerror = () => { fav.src = FAV_FALLBACK; };
    item.appendChild(fav);
  }

  const info = document.createElement('div');
  info.className = 'tab-info';

  const title = document.createElement('div');
  title.className = 'tab-title';
  title.textContent = tab.title;
  title.title = tab.title;
  info.appendChild(title);

  if (settings.showUrl) {
    const url = document.createElement('div');
    url.className = 'tab-url';
    url.textContent = tab.url;
    url.title = tab.url;
    info.appendChild(url);
  }

  item.appendChild(info);

  if (settings.showTime) {
    const time = document.createElement('div');
    time.className = 'tab-time';
    time.textContent = formatTime(tab.closedAt);
    item.appendChild(time);
  }

  const del = document.createElement('button');
  del.className = 'delete-btn';
  del.textContent = '×';
  del.title = '从列表中移除';
  del.addEventListener('click', async (e) => {
    e.stopPropagation();
    await removeClosedTab(tab.id);
    item.remove();
    onRemove();
  });
  item.appendChild(del);

  item.addEventListener('click', () => {
    chrome.tabs.create({ url: tab.url });
    if (settings.closeOnRestore) window.close();
  });

  return item;
}

let allTabs = [];
let currentSettings = null;

function renderList(query) {
  const list = document.getElementById('tabList');
  const empty = document.getElementById('emptyState');
  list.innerHTML = '';

  const filtered = allTabs.filter(tab => matches(tab, query, currentSettings));
  filtered.forEach(tab => list.appendChild(createTabItem(tab, currentSettings, () => {
    allTabs = allTabs.filter(t => t.id !== tab.id);
    renderList(document.getElementById('searchInput').value.trim());
    updateCount(allTabs.length);
  })));

  empty.style.display = filtered.length === 0 ? 'block' : 'none';
}

function updateCount(n) {
  const el = document.getElementById('tabCount');
  el.textContent = n > 0 ? `共 ${n} 条记录` : '';
}

async function main() {
  currentSettings = await getSettings();
  document.body.style.width = `${currentSettings.popupWidth}px`;
  document.getElementById('tabList').style.maxHeight = `${currentSettings.popupHeight}px`;
  applyTheme(currentSettings.theme);

  allTabs = await getClosedTabs();

  updateCount(allTabs.length);

  const scopeLabels = { title: '搜索标题', url: '搜索网址', both: '搜索全部' };
  document.getElementById('searchInput').placeholder = scopeLabels[currentSettings.searchScope] || '搜索';

  renderList('');

  // search
  const searchInput = document.getElementById('searchInput');
  const searchClear = document.getElementById('searchClear');

  searchInput.addEventListener('input', () => {
    const q = searchInput.value.trim();
    searchClear.style.display = q ? 'block' : 'none';
    renderList(q);
  });

  searchClear.addEventListener('click', () => {
    searchInput.value = '';
    searchClear.style.display = 'none';
    searchInput.focus();
    renderList('');
  });

  // clear all
  document.getElementById('clearAll').addEventListener('click', async () => {
    await chrome.storage.local.set({ closedTabs: [] });
    chrome.runtime.sendMessage({ type: 'updateBadge' }).catch(() => {});
    allTabs = [];
    renderList('');
    updateCount(0);
  });

  // settings
  document.getElementById('settingsBtn').addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });
}

main();
