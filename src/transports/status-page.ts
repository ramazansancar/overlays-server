import { VERSION } from '../version.ts';

/**
 * Small self-contained page at `/` for the streamer: is the camera connected, is there a fix?
 * Coordinates are hidden until asked for, so the page can be shown on stream without leaking them.
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
  h1 { font-size:20px; margin:0 0 4px; } .muted { color:var(--muted); }
  .card { background:var(--card); border:1px solid var(--line); border-radius:10px; padding:16px; margin-top:16px; }
  .row { display:flex; flex-wrap:wrap; gap:8px 24px; align-items:baseline; }
  .badge { display:inline-block; padding:1px 8px; border-radius:99px; font-size:13px; font-weight:600; border:1px solid currentColor; }
  .ok { color:var(--ok); } .warn { color:var(--warn); } .bad { color:var(--bad); }
  dl { display:grid; grid-template-columns:max-content 1fr; gap:4px 16px; margin:12px 0 0; }
  dt { color:var(--muted); } dd { margin:0; font-variant-numeric:tabular-nums; overflow-wrap:anywhere; }
  code { background:var(--bg); padding:1px 6px; border-radius:6px; }
  button { font:inherit; padding:4px 12px; border-radius:8px; border:1px solid var(--line); background:var(--card); color:var(--fg); cursor:pointer; }
</style>
</head>
<body>
<main>
  <h1>overlays-server <span class="muted">v${VERSION}</span></h1>
  <div class="muted" id="intro"></div>
  <div class="card"><div class="row"><span id="server-label"></span><code id="ws-url"></code>
    <button id="toggle" type="button"></button></div></div>
  <div id="sources"></div>
</main>
<script>
(() => {
  const tr = (navigator.language || '').toLowerCase().startsWith('tr');
  const T = tr ? {
    intro: 'Harita overlay ayarlarında konum kaynağı olarak <b>Yerel sunucu</b> seç. Bu sayfa yayında gösterilebilir; koordinatlar gizli.',
    server: 'Overlay adresi:', show: 'Konumu göster', hide: 'Konumu gizle', none: 'Kaynak yok.', offline: 'Sunucuya ulaşılamıyor.',
    link: 'Bağlantı', gps: 'GPS', device: 'Cihaz', sats: 'Uydu', pos: 'Konum', speed: 'Hız', heading: 'Yön', alt: 'Rakım',
    age: 'Son veri', active: 'aktif', msg: 'Not', ago: 'sn önce',
    states: { starting:'başlıyor', connecting:'bağlanıyor', online:'bağlı', offline:'koptu', stopped:'durdu',
      unknown:'bilinmiyor', no_fix:'uydu aranıyor', fix:'konum var', stale:'veri durdu' },
  } : {
    intro: 'In the map overlay settings pick <b>Local server</b> as the location source. Safe to show on stream; coordinates are hidden.',
    server: 'Overlay address:', show: 'Show location', hide: 'Hide location', none: 'No sources.', offline: 'Server unreachable.',
    link: 'Link', gps: 'GPS', device: 'Device', sats: 'Satellites', pos: 'Position', speed: 'Speed', heading: 'Heading', alt: 'Altitude',
    age: 'Last data', active: 'active', msg: 'Note', ago: 's ago',
    states: { starting:'starting', connecting:'connecting', online:'online', offline:'offline', stopped:'stopped',
      unknown:'unknown', no_fix:'searching satellites', fix:'fix', stale:'stale' },
  };
  const tone = { online:'ok', fix:'ok', connecting:'warn', starting:'warn', no_fix:'warn', stale:'warn', offline:'bad', stopped:'bad', unknown:'warn' };
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;' })[c]);
  let showPos = false;
  $('intro').innerHTML = T.intro;
  $('server-label').textContent = T.server;
  $('ws-url').textContent = 'ws://' + location.host + '/v1/ws';
  const toggle = $('toggle');
  toggle.textContent = T.show;
  toggle.onclick = () => { showPos = !showPos; toggle.textContent = showPos ? T.hide : T.show; refresh(); };
  const badge = (state) => '<span class="badge ' + (tone[state] || '') + '">' + esc(T.states[state] || state) + '</span>';

  function render(state) {
    if (!state.sources.length) { $('sources').innerHTML = '<div class="card">' + T.none + '</div>'; return; }
    $('sources').innerHTML = state.sources.map((s) => {
      const f = s.lastFix, st = s.status, rows = [];
      if (st.device) rows.push([T.device, [st.device.vendor, st.device.model, st.device.firmware].filter(Boolean).join(' · ')]);
      if (st.satellites !== undefined) rows.push([T.sats, st.satellites]);
      if (f) {
        rows.push([T.pos, showPos ? f.lat.toFixed(5) + ', ' + f.lon.toFixed(5) : '•••']);
        if (f.speed !== undefined) rows.push([T.speed, (f.speed * 3.6).toFixed(0) + ' km/h']);
        if (f.heading !== undefined) rows.push([T.heading, f.heading.toFixed(0) + '°']);
        if (f.altitude !== undefined) rows.push([T.alt, f.altitude.toFixed(0) + ' m']);
        rows.push([T.age, Math.max(0, Math.round((Date.now() - s.lastFixAt) / 1000)) + ' ' + T.ago]);
      }
      if (st.message) rows.push([T.msg, st.message]);
      return '<div class="card"><div class="row"><b>' + esc(s.id) + '</b><span class="muted">' + esc(s.driverName) + '</span>'
        + (s.active ? '<span class="badge ok">' + T.active + '</span>' : '') + '</div>'
        + '<div class="row" style="margin-top:8px">' + T.link + ' ' + badge(st.link) + ' ' + T.gps + ' ' + badge(st.gps) + '</div>'
        + '<dl>' + rows.map(([k, v]) => '<dt>' + esc(k) + '</dt><dd>' + esc(v) + '</dd>').join('') + '</dl></div>';
    }).join('');
  }

  async function refresh() {
    try {
      const token = new URLSearchParams(location.search).get('token');
      const res = await fetch('/v1/state' + (token ? '?token=' + encodeURIComponent(token) : ''), { cache: 'no-store' });
      if (!res.ok) throw new Error(String(res.status));
      render(await res.json());
    } catch {
      $('sources').innerHTML = '<div class="card bad">' + T.offline + '</div>';
    }
  }
  refresh();
  setInterval(refresh, 1000);
})();
</script>
</body>
</html>`;
}
