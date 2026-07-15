// 自维护「最近关闭」历史：监听标签关闭事件，写入 storage.local 持久保存。
//
// 浏览器强关时 SW 可能在写入完成前被终止，因此额外维护一份 openTabsSnapshot：
// 实时把当前所有打开的标签写入 storage.local，下次启动时把快照里的标签补录为
// 「关闭记录」，再清空快照。storage.local 持久化，不受浏览器关闭影响。

const DEFAULTS = {
  maxStored: 300,
  showBadge: true,
  blockedUrls: [],
  deduplicateUrls: false,
};

async function getSettings() {
  const r = await chrome.storage.local.get('settings');
  return { ...DEFAULTS, ...(r.settings || {}) };
}

async function getClosedTabs() {
  const r = await chrome.storage.local.get('closedTabs');
  return r.closedTabs || [];
}

function isTrackableUrl(url) {
  if (!url) return false;
  return /^https?:\/\//.test(url);
}

// 把快照里的标签批量写入关闭历史
async function flushSnapshotToHistory(snapshot) {
  if (!snapshot || !Object.keys(snapshot).length) return;

  const settings = await getSettings();
  const blocked = settings.blockedUrls || [];
  const list = await getClosedTabs();
  const now = Date.now();

  for (const info of Object.values(snapshot)) {
    if (!info.url || !isTrackableUrl(info.url)) continue;
    if (blocked.some(p => p && info.url.includes(p))) continue;
    if (settings.deduplicateUrls) {
      const idx = list.findIndex(t => t.url === info.url);
      if (idx !== -1) list.splice(idx, 1);
    }
    list.unshift({
      id: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}_${Math.random()}`,
      url: info.url,
      title: info.title,
      favIconUrl: info.favIconUrl,
      closedAt: now,
    });
  }

  const max = settings.maxStored || DEFAULTS.maxStored;
  if (list.length > max) list.length = max;
  await chrome.storage.local.set({ closedTabs: list });
}

// 更新 openTabsSnapshot：查询所有当前打开的标签，整体覆盖写入
async function syncOpenTabsSnapshot() {
  try {
    const tabs = await chrome.tabs.query({});
    const snapshot = {};
    for (const tab of tabs) {
      if (tab.id != null && isTrackableUrl(tab.url)) {
        snapshot[`tab_${tab.id}`] = {
          url: tab.url,
          title: tab.title || tab.url,
          favIconUrl: tab.favIconUrl || '',
        };
      }
    }
    await chrome.storage.local.set({ openTabsSnapshot: snapshot });
  } catch {}
}

// 串行写队列：普通单标签关闭时使用，避免并发写入互相覆盖
let writeQueue = Promise.resolve();

function enqueueTabRecord(tabId) {
  writeQueue = writeQueue.then(async () => {
    // 从快照里取该标签信息（此时快照还未更新）
    const r = await chrome.storage.local.get('openTabsSnapshot');
    const snapshot = r.openTabsSnapshot || {};
    const info = snapshot[`tab_${tabId}`];
    if (!info || !info.url) return;

    const settings = await getSettings();
    const blocked = settings.blockedUrls || [];
    if (blocked.some(p => p && info.url.includes(p))) return;

    const list = await getClosedTabs();
    if (settings.deduplicateUrls) {
      const idx = list.findIndex(t => t.url === info.url);
      if (idx !== -1) list.splice(idx, 1);
    }
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
  }).catch(() => {});
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

// 启动时：把上次快照补录为关闭历史，再重建当前快照
async function onBrowserStart() {
  const r = await chrome.storage.local.get('openTabsSnapshot');
  const snapshot = r.openTabsSnapshot || {};
  if (Object.keys(snapshot).length) {
    await flushSnapshotToHistory(snapshot);
    await chrome.storage.local.remove('openTabsSnapshot');
  }
  await syncOpenTabsSnapshot();
  updateBadge();
}

chrome.tabs.onCreated.addListener(syncOpenTabsSnapshot);
chrome.tabs.onUpdated.addListener((_id, changeInfo) => {
  if (changeInfo.url || changeInfo.title) syncOpenTabsSnapshot();
});
chrome.tabs.onRemoved.addListener((tabId) => {
  enqueueTabRecord(tabId);
  // 关闭后同步更新快照，把该标签从快照中移除
  syncOpenTabsSnapshot();
});

chrome.runtime.onInstalled.addListener(async () => {
  await chrome.storage.local.remove('openTabsSnapshot');
  await syncOpenTabsSnapshot();
  updateBadge();
});
chrome.runtime.onStartup.addListener(onBrowserStart);

chrome.storage.onChanged.addListener((changes) => {
  if (changes.closedTabs || changes.settings) updateBadge();
});

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'updateBadge') updateBadge();
});
