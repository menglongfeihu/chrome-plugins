const FAV_FALLBACK =
  'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16">' +
  '<rect width="16" height="16" rx="2" fill="%23e2e8f0"/>' +
  '<text x="8" y="12" text-anchor="middle" font-size="10" fill="%2394a3b8">○</text></svg>';

const DEFAULTS = {
  maxStored: 300,
  pageSize: 20,
  popupWidth: 380,
  popupHeight: 400,
  showFavicon: true,
  showUrl: true,
  showTime: true,
  showBadge: true,
  caseSensitive: false,
  closeOnRestore: false,
  removeOnRestore: false,
  deduplicateUrls: false,
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

async function focusOrOpenTab(url, activate = true) {
  const found = await chrome.tabs.query({ url });
  if (found.length > 0) {
    const t = found[found.length - 1];
    await chrome.tabs.update(t.id, { active: activate });
    if (activate) await chrome.windows.update(t.windowId, { focused: true });
    return t;
  }
  return chrome.tabs.create({ url, active: activate });
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
  if (selectedIds.has(tab.id)) item.classList.add('selected');

  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.className = 'tab-item-check';
  checkbox.checked = selectedIds.has(tab.id);
  checkbox.addEventListener('click', (e) => {
    e.stopPropagation();
    if (checkbox.checked) { selectedIds.add(tab.id); item.classList.add('selected'); }
    else { selectedIds.delete(tab.id); item.classList.remove('selected'); }
    updateOpenSelected();
  });
  item.appendChild(checkbox);

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
  del.title = '从列表中移除';
  del.innerHTML = '<svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M6 2h4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="M2 4.5h12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="M3.5 4.5l.75 9.5a.5.5 0 00.5.5h6.5a.5.5 0 00.5-.5l.75-9.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M6.5 7v5M9.5 7v5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>';
  del.addEventListener('click', async (e) => {
    e.stopPropagation();
    await removeClosedTab(tab.id);
    item.remove();
    onRemove();
  });
  item.appendChild(del);

  item.addEventListener('click', async () => {
    if (settings.removeOnRestore) {
      await removeClosedTab(tab.id);
      item.remove();
      onRemove();
    }
    await focusOrOpenTab(tab.url, true);
    if (settings.closeOnRestore) window.close();
  });

  return item;
}

let allTabs = [];
let currentSettings = null;
let selectedIds = new Set();
let currentPage = 1;

function updateOpenSelected() {
  const btn = document.getElementById('openSelected');
  const clearBtn = document.getElementById('clearAll');
  const n = selectedIds.size;
  btn.style.display = n > 0 ? 'inline-flex' : 'none';
  btn.textContent = `打开选中 (${n})`;
  clearBtn.innerHTML = n > 0
    ? `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" style="flex-shrink:0"><path d="M6 2h4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="M2 4.5h12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="M3.5 4.5l.75 9.5a.5.5 0 00.5.5h6.5a.5.5 0 00.5-.5l.75-9.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M6.5 7v5M9.5 7v5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>清空选中 (${n})`
    : `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" style="flex-shrink:0"><path d="M6 2h4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="M2 4.5h12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="M3.5 4.5l.75 9.5a.5.5 0 00.5.5h6.5a.5.5 0 00.5-.5l.75-9.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M6.5 7v5M9.5 7v5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>清空`;
}

function renderPagination(totalPages) {
  const bar = document.getElementById('pagination');
  if (totalPages <= 1) { bar.style.display = 'none'; return; }
  bar.style.display = 'flex';
  document.getElementById('pgInfo').textContent = `${currentPage} / ${totalPages}`;
  document.getElementById('pgFirst').disabled = currentPage === 1;
  document.getElementById('pgPrev').disabled = currentPage === 1;
  document.getElementById('pgNext').disabled = currentPage === totalPages;
  document.getElementById('pgLast').disabled = currentPage === totalPages;
  document.getElementById('pgGoto').max = totalPages;
}

function renderList(query) {
  const list = document.getElementById('tabList');
  const empty = document.getElementById('emptyState');
  list.innerHTML = '';

  const filtered = allTabs.filter(tab => matches(tab, query, currentSettings));
  const pageSize = (currentSettings && currentSettings.pageSize) || 20;
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  if (currentPage > totalPages) currentPage = totalPages;

  const start = (currentPage - 1) * pageSize;
  filtered.slice(start, start + pageSize).forEach(tab => list.appendChild(createTabItem(tab, currentSettings, () => {
    allTabs = allTabs.filter(t => t.id !== tab.id);
    renderList(document.getElementById('searchInput').value.trim());
    updateCount(allTabs.length);
    syncBadge(allTabs.length);
  })));

  empty.style.display = filtered.length === 0 ? 'block' : 'none';
  renderPagination(totalPages);
}

function updateCount(n) {
  const el = document.getElementById('tabCount');
  el.textContent = n > 0 ? `共 ${n} 条记录` : '';
}

async function syncBadge(count) {
  const settings = await getSettings();
  if (!settings.showBadge) { chrome.action.setBadgeText({ text: '' }); return; }
  chrome.action.setBadgeText({ text: count > 0 ? String(count) : '' });
  chrome.action.setBadgeBackgroundColor({ color: '#3b82f6' });
}

async function main() {
  currentSettings = await getSettings();
  document.body.style.width = `${currentSettings.popupWidth}px`;
  document.body.style.height = `${currentSettings.popupHeight}px`;
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
    currentPage = 1;
    renderList(q);
  });

  searchClear.addEventListener('click', () => {
    searchInput.value = '';
    searchClear.style.display = 'none';
    searchInput.focus();
    currentPage = 1;
    renderList('');
  });

  // 分页
  const getQuery = () => searchInput.value.trim();
  document.getElementById('pgFirst').addEventListener('click', () => {
    currentPage = 1;
    renderList(getQuery());
  });
  document.getElementById('pgPrev').addEventListener('click', () => {
    currentPage--;
    renderList(getQuery());
  });
  document.getElementById('pgNext').addEventListener('click', () => {
    currentPage++;
    renderList(getQuery());
  });
  document.getElementById('pgLast').addEventListener('click', () => {
    const filtered = allTabs.filter(tab => matches(tab, getQuery(), currentSettings));
    const pageSize = currentSettings.pageSize || 20;
    currentPage = Math.max(1, Math.ceil(filtered.length / pageSize));
    renderList(getQuery());
  });
  document.getElementById('pgGotoBtn').addEventListener('click', () => {
    const val = parseInt(document.getElementById('pgGoto').value, 10);
    if (!isNaN(val) && val >= 1) {
      currentPage = val;
      renderList(getQuery());
      document.getElementById('pgGoto').value = '';
    }
  });
  document.getElementById('pgGoto').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') document.getElementById('pgGotoBtn').click();
  });

  // clear all / clear selected
  document.getElementById('clearAll').addEventListener('click', async () => {
    if (selectedIds.size > 0) {
      allTabs = allTabs.filter(t => !selectedIds.has(t.id));
      await chrome.storage.local.set({ closedTabs: allTabs });
      selectedIds.clear();
      updateOpenSelected();
      renderList(searchInput.value.trim());
      updateCount(allTabs.length);
      syncBadge(allTabs.length);
    } else {
      await chrome.storage.local.set({ closedTabs: [] });
      allTabs = [];
      renderList('');
      updateCount(0);
      syncBadge(0);
    }
  });

  // 全选
  document.getElementById('selectAll').addEventListener('click', () => {
    const query = searchInput.value.trim();
    const visible = allTabs.filter(tab => matches(tab, query, currentSettings));
    visible.forEach(t => selectedIds.add(t.id));
    renderList(query);
    updateOpenSelected();
  });

  // 反选
  document.getElementById('invertSelect').addEventListener('click', () => {
    const query = searchInput.value.trim();
    const visible = allTabs.filter(tab => matches(tab, query, currentSettings));
    visible.forEach(t => {
      if (selectedIds.has(t.id)) selectedIds.delete(t.id);
      else selectedIds.add(t.id);
    });
    renderList(query);
    updateOpenSelected();
  });

  // settings
  document.getElementById('settingsBtn').addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });

  // open selected
  document.getElementById('openSelected').addEventListener('click', async () => {
    const tabs = allTabs.filter(t => selectedIds.has(t.id));
    for (let i = 0; i < tabs.length; i++) {
      const t = tabs[i];
      if (currentSettings.removeOnRestore) await removeClosedTab(t.id);
      await focusOrOpenTab(t.url, i === tabs.length - 1);
    }
    if (currentSettings.removeOnRestore) {
      allTabs = allTabs.filter(t => !selectedIds.has(t.id));
      renderList(document.getElementById('searchInput').value.trim());
      updateCount(allTabs.length);
      syncBadge(allTabs.length);
    }
    selectedIds.clear();
    updateOpenSelected();
    if (currentSettings.closeOnRestore) window.close();
  });
}

main();
