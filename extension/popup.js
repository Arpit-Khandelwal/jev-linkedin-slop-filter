const STATS_URL = 'http://127.0.0.1:8787/stats';

const box = document.getElementById('enabled');
const dot = document.getElementById('dot');
const status = document.getElementById('status');
const judged = document.getElementById('judged');
const split = document.getElementById('split');

chrome.storage.sync.get({ enabled: true }, ({ enabled }) => {
  box.checked = enabled;
});

box.addEventListener('change', () => {
  chrome.storage.sync.set({ enabled: box.checked });
});

const showOffline = () => {
  dot.dataset.live = 'no';
  status.innerHTML = 'proxy offline — <code>npm start</code>';
  judged.textContent = '—';
  split.textContent = '';
};

const loadStats = async () => {
  try {
    const response = await fetch(STATS_URL, { cache: 'no-store' });
    if (!response.ok) throw new Error(String(response.status));
    const { local, jev, cached, errors } = await response.json();
    dot.dataset.live = 'yes';
    status.textContent = errors > 0 ? `connected · ${errors} errors` : 'proxy connected';
    judged.textContent = local + jev + cached;
    split.textContent = `${jev} jev · ${local} rule`;
  } catch {
    showOffline();
  }
};

loadStats();
setInterval(loadStats, 2000);
