const toggle = document.getElementById('toggle');
const status = document.getElementById('status');

chrome.storage.local.get({ enabled: false }, ({ enabled }) => { toggle.checked = enabled; });
toggle.addEventListener('change', () => chrome.storage.local.set({ enabled: toggle.checked }));

document.getElementById('debug').addEventListener('click', async () => {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const report = await chrome.tabs.sendMessage(tab.id, { type: 'debug-report' });
    await navigator.clipboard.writeText(JSON.stringify(report, null, 2));
    status.textContent = 'Copied.';
  } catch {
    status.textContent = 'Open or reload a Linear tab first.';
  }
});
