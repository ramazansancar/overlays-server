import { REPO_URL, VERSION } from '../version.ts';

/**
 * Small self-contained page at `/` for the streamer: is the camera connected, is there a fix?
 * Live over the same WebSocket overlays use (`/v1/ws?source=*&motion=1`), so it updates the moment data arrives.
 * Coordinates are hidden until asked for, so the page can be shown on stream without leaking them.
 * Also offers the diagnostics download (`/v1/diagnostics`) to attach to a bug report.
 */
export function statusPageHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>overlays-server</title>
<style>
  :root { color-scheme: light dark; --bg:#f6f7f9; --fg:#14171c; --muted:#5d6673; --card:#fff; --line:#dde1e7;
    --ok:#1a7f37; --warn:#9a6700; --bad:#cf222e; }
  @media (prefers-color-scheme: dark) { :root { --bg:#0e1116; --fg:#e6e8eb; --muted:#9aa4b2; --card:#161b22;
    --line:#2a313c; --ok:#3fb950; --warn:#d29922; --bad:#f85149; } }
  body { margin:0; background:var(--bg); color:var(--fg); font:15px/1.5 system-ui, sans-serif; }
  main { max-width:860px; margin:0 auto; padding:24px 16px 48px; }
  h1 { font-size:20px; margin:0 0 4px; } h2 { font-size:16px; margin:0 0 8px; } .muted { color:var(--muted); }
  .card { background:var(--card); border:1px solid var(--line); border-radius:10px; padding:16px; margin-top:16px; }
  .row { display:flex; flex-wrap:wrap; gap:8px 24px; align-items:center; }
  .badge { display:inline-block; padding:1px 8px; border-radius:99px; font-size:13px; font-weight:600; border:1px solid currentColor; }
  .ok { color:var(--ok); } .warn { color:var(--warn); } .bad { color:var(--bad); }
  dl { display:grid; grid-template-columns:max-content 1fr; gap:4px 16px; margin:12px 0 0; }
  dt { color:var(--muted); } dd { margin:0; font-variant-numeric:tabular-nums; overflow-wrap:anywhere; }
  code { background:var(--bg); padding:1px 6px; border-radius:6px; }
  a { color:inherit; } footer { margin-top:24px; font-size:13px; } p { margin:0 0 8px; }
  button, .button { font:inherit; padding:4px 12px; border-radius:8px; border:1px solid var(--line); background:var(--card);
    color:var(--fg); cursor:pointer; text-decoration:none; display:inline-block; }
  label.check { display:inline-flex; gap:6px; align-items:center; cursor:pointer; }
  summary { cursor:pointer; user-select:none; } summary:hover { color:var(--fg); }
</style>
</head>
<body>
<main>
  <h1>overlays-server <span class="muted">v${VERSION}</span></h1>
  <div class="muted" id="intro"></div>
  <div class="card"><div class="row"><span id="server-label"></span><code id="ws-url"></code>
    <span id="conn" class="badge warn"></span><button id="toggle" type="button"></button></div></div>
  <div id="sources"></div>
  <div class="card">
    <h2 id="diag-title"></h2>
    <p class="muted" id="diag-text"></p>
    <div class="row">
      <a class="button" id="diag-link" href="/v1/diagnostics" download></a>
      <label class="check"><input type="checkbox" id="diag-pos"> <span id="diag-pos-label"></span></label>
    </div>
  </div>
  <footer class="muted"><span id="repo-label"></span> <a href="${REPO_URL}" target="_blank" rel="noopener noreferrer">${REPO_URL.replace('https://', '')}</a> · AGPL-3.0</footer>
</main>
<script>
(() => {
  const tr = (navigator.language || '').toLowerCase().startsWith('tr');
  const T = tr ? {
    intro: 'Harita overlay ayarlarında konum kaynağı olarak <b>Araç kamerası GPS — overlays-server [yerel]</b> seç. Bu sayfa yayında gösterilebilir; koordinatlar gizli.',
    server: 'Overlay adresi:', repo: 'Kaynak kod, hata bildirimi ve kurulum rehberi:', show: 'Konumu göster', hide: 'Konumu gizle',
    none: 'Kaynak yok.', live: 'canlı', connecting: 'bağlanıyor…', lost: 'sunucu bağlantısı yok, yeniden deneniyor…',
    link: 'Bağlantı', gps: 'GPS', device: 'Cihaz', sats: 'Uydu', pos: 'Konum', speed: 'Hız', heading: 'Yön', alt: 'Rakım',
    age: 'Son veri', active: 'aktif', msg: 'Not', ago: 'sn önce', storage: 'Hafıza kartı', free: 'boş', cameras: 'Kamera',
    streams: 'RTSP (OBS Ortam Kaynağı)', gforce: 'İvme (g)', details: 'Diğer cihaz bilgileri', quality: 'Fix kalitesi',
    diagTitle: 'Sorun mu var? Tanı verisini indir',
    diagText: 'Cihazdan gelen son ~2 dakikalık ham veri, son log satırları, ayarlar ve durum tek bir dosyada. Hata bildirirken bu dosyayı issue\\'ya ekle; sorunu aynen tekrar oynatıp düzeltebiliriz. Wi-Fi şifresi, seri numarası ve MAC adresleri her zaman gizlenir.',
    diagLink: 'Tanı verisini indir (.json)', diagPos: 'Konumu dahil et (harita/konum sorunlarında gerekli; dosyayı herkese açık paylaşma)',
    states: { starting:'başlıyor', connecting:'bağlanıyor', online:'bağlı', offline:'koptu', stopped:'durdu',
      unknown:'bilinmiyor', no_fix:'uydu aranıyor', fix:'konum var', stale:'veri durdu' },
  } : {
    intro: 'In the map overlay settings pick <b>Dashcam GPS — overlays-server [local]</b> as the location source. Safe to show on stream; coordinates are hidden.',
    server: 'Overlay address:', repo: 'Source code, issues and setup guide:', show: 'Show location', hide: 'Hide location',
    none: 'No sources.', live: 'live', connecting: 'connecting…', lost: 'no connection to the server, retrying…',
    link: 'Link', gps: 'GPS', device: 'Device', sats: 'Satellites', pos: 'Position', speed: 'Speed', heading: 'Heading', alt: 'Altitude',
    age: 'Last data', active: 'active', msg: 'Note', ago: 's ago', storage: 'Memory card', free: 'free', cameras: 'Cameras',
    streams: 'RTSP (OBS Media Source)', gforce: 'Acceleration (g)', details: 'Other device info', quality: 'Fix quality',
    diagTitle: 'Having a problem? Download diagnostics',
    diagText: 'The last ~2 minutes of raw device data, recent log lines, settings and state in one file. Attach it to your issue; we can replay the problem exactly and fix it. Wi-Fi passwords, serial numbers and MAC addresses are always removed.',
    diagLink: 'Download diagnostics (.json)', diagPos: 'Include my position (needed for map / position problems; do not share the file publicly)',
    states: { starting:'starting', connecting:'connecting', online:'online', offline:'offline', stopped:'stopped',
      unknown:'unknown', no_fix:'searching satellites', fix:'fix', stale:'stale' },
  };
  const tone = { online:'ok', fix:'ok', connecting:'warn', starting:'warn', no_fix:'warn', stale:'warn', offline:'bad', stopped:'bad', unknown:'warn' };
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;' })[c]);
  const token = new URLSearchParams(location.search).get('token');
  const wsBase = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/v1/ws';

  // Client-side state, filled by the stream: source id -> { status, fix, fixAt, motion }.
  const sources = new Map();
  const openDetails = new Set();
  let showPos = false;

  $('intro').innerHTML = T.intro;
  $('server-label').textContent = T.server;
  $('repo-label').textContent = T.repo;
  $('ws-url').textContent = wsBase;
  $('diag-title').textContent = T.diagTitle;
  $('diag-text').textContent = T.diagText;
  $('diag-link').textContent = T.diagLink;
  $('diag-pos-label').textContent = T.diagPos;
  const updateDiagLink = () => {
    const q = new URLSearchParams();
    if ($('diag-pos').checked) q.set('positions', '1');
    if (token) q.set('token', token);
    $('diag-link').href = '/v1/diagnostics' + (q.size ? '?' + q : '');
  };
  $('diag-pos').addEventListener('change', updateDiagLink);
  updateDiagLink();

  const toggle = $('toggle');
  toggle.textContent = T.show;
  toggle.onclick = () => { showPos = !showPos; toggle.textContent = showPos ? T.hide : T.show; render(); };
  document.addEventListener('toggle', (e) => {
    const id = e.target && e.target.dataset ? e.target.dataset.source : undefined;
    if (id === undefined) return;
    if (e.target.open) openDetails.add(id); else openDetails.delete(id);
  }, true);

  const setConn = (text, cls) => { const el = $('conn'); el.textContent = text; el.className = 'badge ' + cls; };
  const badge = (state) => '<span class="badge ' + (tone[state] || '') + '">' + esc(T.states[state] || state) + '</span>';
  // Open the position in a map service (only rendered while the position is shown).
  const mapLinks = (lat, lon) => {
    const a = lat.toFixed(6), o = lon.toFixed(6);
    const links = [
      ['Google Maps', 'https://www.google.com/maps?q=' + a + ',' + o],
      ['Yandex', 'https://yandex.com/maps/?pt=' + o + ',' + a + '&z=16&l=map'],
      ['OpenStreetMap', 'https://www.openstreetmap.org/?mlat=' + a + '&mlon=' + o + '#map=16/' + a + '/' + o],
    ];
    return links.map(([name, url]) => '<a href="' + esc(url) + '" target="_blank" rel="noopener noreferrer">' + name + '</a>').join(' · ');
  };
  /** A row value: plain text (escaped) or { html } for trusted markup built here. */
  const cell = (v) => (v && typeof v === 'object' && 'html' in v ? v.html : esc(v));

  function render() {
    if (!sources.size) { $('sources').innerHTML = '<div class="card">' + T.none + '</div>'; return; }
    $('sources').innerHTML = [...sources.entries()].map(([id, s]) => {
      const st = s.status || {}, f = s.fix, dev = st.device, rows = [];
      if (dev) rows.push([T.device, [dev.vendor, dev.model, dev.firmware].filter(Boolean).join(' · ')]);
      if (dev && dev.storage) {
        const gb = (b) => (b / 1e9).toFixed(1) + ' GB';
        rows.push([T.storage, gb(dev.storage.totalBytes) + ' · ' + gb(dev.storage.freeBytes) + ' ' + T.free]);
      }
      if (dev && dev.cameras !== undefined) rows.push([T.cameras, dev.cameras]);
      if (dev && dev.streams) for (const x of dev.streams) rows.push([T.streams + ' ' + x.name, x.url]);
      if (st.satellites !== undefined) rows.push([T.sats, st.satellites]);
      if (s.motion) rows.push([T.gforce, ['x', 'y', 'z'].map((k) => k + ' ' + s.motion[k].toFixed(2)).join('  ')]);
      if (f) {
        rows.push([T.pos, showPos
          ? { html: esc(f.lat.toFixed(5) + ', ' + f.lon.toFixed(5)) + ' <span class="muted">·</span> ' + mapLinks(f.lat, f.lon) }
          : '•••']);
        if (f.speed !== undefined) rows.push([T.speed, (f.speed * 3.6).toFixed(0) + ' km/h']);
        if (f.heading !== undefined) rows.push([T.heading, f.heading.toFixed(0) + '°']);
        if (f.altitude !== undefined) rows.push([T.alt, f.altitude.toFixed(0) + ' m']);
        if (f.quality !== undefined) rows.push([T.quality, f.quality + (f.hdop !== undefined ? ' · HDOP ' + f.hdop : '')]);
        rows.push([T.age, Math.max(0, Math.round((Date.now() - s.fixAt) / 1000)) + ' ' + T.ago]);
      }
      if (st.message) rows.push([T.msg, st.message]);
      const extra = dev && dev.details && Object.keys(dev.details).length
        ? '<details style="margin-top:8px" data-source="' + esc(id) + '"' + (openDetails.has(id) ? ' open' : '') + '><summary class="muted">'
          + T.details + '</summary><dl>'
          + Object.entries(dev.details).map(([k, v]) => '<dt>' + esc(k) + '</dt><dd>' + esc(v) + '</dd>').join('') + '</dl></details>'
        : '';
      return '<div class="card"><div class="row"><b>' + esc(id) + '</b><span class="muted">' + esc(st.driverName || st.driver || '') + '</span>'
        + (st.active ? '<span class="badge ok">' + T.active + '</span>' : '') + '</div>'
        + '<div class="row" style="margin-top:8px">' + T.link + ' ' + badge(st.link) + ' ' + T.gps + ' ' + badge(st.gps) + '</div>'
        + '<dl>' + rows.map(([k, v]) => '<dt>' + esc(k) + '</dt><dd>' + cell(v) + '</dd>').join('') + '</dl>' + extra + '</div>';
    }).join('');
  }

  // Messages can come many times a second (motion); draw at most every 200 ms.
  let renderTimer = 0;
  const scheduleRender = () => { if (!renderTimer) renderTimer = setTimeout(() => { renderTimer = 0; render(); }, 200); };
  setInterval(render, 1000); // keeps "last data N s ago" ticking

  const entry = (id) => { if (!sources.has(id)) sources.set(id, {}); return sources.get(id); };
  let retryMs = 1000;
  function connect() {
    setConn(T.connecting, 'warn');
    const ws = new WebSocket(wsBase + '?source=*&motion=1' + (token ? '&token=' + encodeURIComponent(token) : ''));
    ws.onopen = () => { retryMs = 1000; setConn(T.live, 'ok'); };
    ws.onmessage = (e) => {
      let m;
      try { m = JSON.parse(e.data); } catch { return; }
      if (m.type === 'hello') sources.clear();
      else if (m.type === 'status') entry(m.source).status = m;
      else if (m.type === 'fix') { const s = entry(m.source); s.fix = m; s.fixAt = Date.now(); }
      else if (m.type === 'motion') entry(m.source).motion = m;
      else return;
      scheduleRender();
    };
    ws.onclose = () => {
      setConn(T.lost, 'bad');
      setTimeout(connect, retryMs);
      retryMs = Math.min(retryMs * 2, 10000);
    };
  }
  render();
  connect();
})();
</script>
</body>
</html>`;
}
