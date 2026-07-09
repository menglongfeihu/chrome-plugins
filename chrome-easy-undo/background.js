// 自维护「最近关闭」历史：监听标签关闭事件，写入 storage.local 持久保存。
// onRemoved 触发时标签已无法查询，故在 onCreated/onUpdated 时把信息缓存进
// storage.session（SW 重启后仍保留），关闭时再取出来存档。

const DEFAULTS = {
  maxStored: 300,
  showBadge: true,
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

// 只缓存真实网页，跳过内部页面
function isTrackableUrl(url) {
  if (!url) return false;
  return /^https?:\/\//.test(url);
}

async function cacheTab(tab) {
  if (!tab || tab.id == null || !isTrackableUrl(tab.url)) return;
  await chrome.storage.session.set({
    [`tab_${tab.id}`]: {
      url: tab.url,
      title: tab.title || tab.url,
      favIconUrl: tab.favIconUrl || '',
    },
  });
}

async function popCachedTab(tabId) {
  const key = `tab_${tabId}`;
  const r = await chrome.storage.session.get(key);
  const info = r[key];
  if (info) await chrome.storage.session.remove(key);
  return info;
}

async function recordClosedTab(tabId) {
  const info = await popCachedTab(tabId);
  if (!info || !info.url) return;

  const settings = await getSettings();
  const blocked = settings.blockedUrls || [];
  if (blocked.some(p => p && info.url.includes(p))) return;

  const list = await getClosedTabs();
  list.unshift({
    id: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}_${Math.random()}`,
    url: info.url,
    title: info.title,
    favIconUrl: info.favIconUrl,
    closedAt: Date.now(),
  });

  const max = settings.maxStored || DEFAULTS.maxStored;
  if (list.length > max) list.length = max;
  await chrome.storage.local.set({ closedTabs: list });
  // storage.onChanged 会触发 updateBadge
}

async function updateBadge() {
  const settings = await getSettings();
  if (!settings.showBadge) {
    chrome.action.setBadgeText({ text: '' });
    return;
  }
  const count = (await getClosedTabs()).length;
  chrome.action.setBadgeText({ text: count > 0 ? String(count) : '' });
  chrome.action.setBadgeBackgroundColor({ color: '#3b82f6' });
}

// 把当前所有已打开标签补进缓存，避免 SW 首次启动前打开的标签丢失信息
async function primeCache() {
  try {
    const tabs = await chrome.tabs.query({});
    await Promise.all(tabs.map(cacheTab));
  } catch {}
  updateBadge();
}

chrome.tabs.onCreated.addListener(cacheTab);
chrome.tabs.onUpdated.addListener((_tabId, _changeInfo, tab) => cacheTab(tab));
chrome.tabs.onRemoved.addListener(recordClosedTab);

chrome.runtime.onInstalled.addListener(primeCache);
chrome.runtime.onStartup.addListener(primeCache);

chrome.storage.onChanged.addListener((changes) => {
  if (changes.closedTabs || changes.settings) updateBadge();
});

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'updateBadge') updateBadge();
});
