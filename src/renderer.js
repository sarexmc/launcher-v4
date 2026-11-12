const $ = id => document.getElementById(id);
const S = { account: null, busy: false, back: false, cur: null, adsOff: false, adTimer: null, loaded: false };
const TITLES = { home: 'Inicio', mods: 'Mods', skins: 'Skins', security: 'Seguridad', settings: 'Ajustes' };
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

// ---------- Navegación ----------
function show(v) {
  document.querySelectorAll('.view').forEach(e => e.classList.toggle('active', e.id === 'v-' + v));
  document.querySelectorAll('.nav').forEach(b => b.classList.toggle('active', b.dataset.view === v));
  $('title').textContent = TITLES[v];
  if (v === 'skins') loadSkins();
  if (v === 'mods') loadMods();
  if (v === 'security') loadSecurity();
}
document.querySelectorAll('.nav').forEach(b => b.onclick = () => show(b.dataset.view));
document.querySelectorAll('[data-w]').forEach(b => b.onclick = () => sarex.invoke('win-ctl', b.dataset.w));
$('player').onclick = () => show('settings');

function say(t, err) { $('msg').textContent = t || ''; $('msg').classList.toggle('err', !!err); }

// ---------- Skins: dibujo ----------
const loadImg = src => new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = no; i.src = src; });
function isSlim(img) {
  if (img.height !== 64) return false;
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const x = c.getContext('2d'); x.drawImage(img, 0, 0);
  return x.getImageData(55, 24, 1, 1).data[3] === 0;
}
function drawFace(cv, img) {
  cv.width = cv.height = 8; const g = cv.getContext('2d'); g.imageSmoothingEnabled = false;
  g.clearRect(0, 0, 8, 8); g.drawImage(img, 8, 8, 8, 8, 0, 0, 8, 8); g.drawImage(img, 40, 8, 8, 8, 0, 0, 8, 8);
}
function drawSkin(cv, img, slim, back, sc) {
  const g = cv.getContext('2d'); cv.width = 16 * sc; cv.height = 32 * sc; g.imageSmoothingEnabled = false;
  const old = img.height === 32, aw = slim ? 3 : 4;
  const P = (sx, sy, w, h, dx, dy, flip) => {
    g.save(); if (flip) { g.translate((2 * dx + w) * sc, 0); g.scale(-1, 1); }
    g.drawImage(img, sx, sy, w, h, dx * sc, dy * sc, w * sc, h * sc); g.restore();
  };
  if (!back) {
    P(4, 20, 4, 12, 4, 20); old ? P(4, 20, 4, 12, 8, 20, true) : P(20, 52, 4, 12, 8, 20);
    P(20, 20, 8, 12, 4, 8);
    P(44, 20, aw, 12, 4 - aw, 8); old ? P(44, 20, aw, 12, 12, 8, true) : P(36, 52, aw, 12, 12, 8);
    P(8, 8, 8, 8, 4, 0);
    if (!old) { P(4, 36, 4, 12, 4, 20); P(4, 52, 4, 12, 8, 20); P(20, 36, 8, 12, 4, 8); P(44, 36, aw, 12, 4 - aw, 8); P(52, 52, aw, 12, 12, 8); }
    P(40, 8, 8, 8, 4, 0);
  } else {
    old ? P(12, 20, 4, 12, 4, 20, true) : P(28, 52, 4, 12, 4, 20); P(12, 20, 4, 12, 8, 20);
    P(32, 20, 8, 12, 4, 8);
    old ? P(44 + aw + 4, 20, aw, 12, 4 - aw, 8, true) : P(36 + aw + 4, 52, aw, 12, 4 - aw, 8); P(44 + aw + 4, 20, aw, 12, 12, 8);
    P(24, 8, 8, 8, 4, 0);
    if (!old) { P(12, 52, 4, 12, 4, 20); P(12, 36, 4, 12, 8, 20); P(32, 36, 8, 12, 4, 8); P(52 + aw + 4, 52, aw, 12, 4 - aw, 8); P(44 + aw + 4, 36, aw, 12, 12, 8); }
    P(56, 8, 8, 8, 4, 0);
  }
}
async function showSkin(data, slim, name, src) {
  $('skerr').textContent = '';
  $('skname').textContent = name; $('sksrc').textContent = src || '';
  if (!data) { S.cur = null; $('skcan').hidden = true; $('skempty').hidden = false; return; }
  const img = await loadImg(data);
  S.cur = { img, slim: slim == null ? isSlim(img) : slim };
  $('skcan').hidden = false; $('skempty').hidden = true;
  drawSkin($('skcan'), img, S.cur.slim, S.back, 10);
}
$('fb').onclick = () => { S.back = !S.back; $('fb').textContent = S.back ? 'Ver frente' : 'Ver espalda'; if (S.cur) drawSkin($('skcan'), S.cur.img, S.cur.slim, S.back, 10); };

async function refreshMine() {
  const m = await sarex.invoke('skin-mine');
  const nm = S.account ? S.account.name : 'Tu skin';
  const label = { local: 'Skin importada por ti', premium: 'Skin de tu cuenta de Minecraft', default: 'Sin skin personalizada' }[m.source];
  await showSkin(m.data, m.slim, nm, label);
  $('skdel').hidden = m.source !== 'local';
  const pf = $('pface'), g = pf.getContext('2d');
  if (m.data) drawFace(pf, await loadImg(m.data)); else { pf.width = pf.height = 8; g.fillStyle = '#6b4a8c'; g.fillRect(0, 0, 8, 8); }
}
async function loadSkins() {
  if (S.loaded) return; S.loaded = true;
  await refreshMine();
  const list = await sarex.invoke('skin-gallery'), grid = $('grid'); grid.replaceChildren();
  $('gridempty').hidden = list.length > 0;
  for (const s of list) {
    const b = el('button', 'sk'), c = document.createElement('canvas');
    drawFace(c, await loadImg(s.data)); b.append(c, el('span', '', s.player));
    b.onclick = () => showSkin(s.data, null, s.player, 'Skin de la comunidad');
    grid.append(b);
  }
}
$('skimp').onclick = async () => {
  const r = await sarex.invoke('skin-import');
  if (r.ok) { await showSkin(r.data, null, S.account ? S.account.name : 'Tu skin', 'Skin importada por ti'); $('skdel').hidden = false; refreshMine(); }
  else if (!r.canceled) $('skerr').textContent = r.error;
};
$('skdel').onclick = async () => { await sarex.invoke('skin-remove'); refreshMine(); };
$('lkbtn').onclick = async () => {
  const n = $('lkname').value.trim(); if (!n) return;
  const r = await sarex.invoke('skin-lookup', n);
  if (r.ok) showSkin(r.data, r.slim, n, 'Skin premium de ' + n); else $('skerr').textContent = r.error;
};
$('lkname').onkeydown = e => { if (e.key === 'Enter') $('lkbtn').click(); };

// ---------- Cuenta ----------
function refreshAccount() {
  const a = S.account;
  $('pname').textContent = a ? a.name : 'Sin sesión';
  const b = $('pbadge'); b.textContent = a ? (a.type === 'ms' ? 'Premium' : 'Sin cuenta') : ''; b.className = a && a.type === 'ms' ? 'prem' : '';
  b.hidden = !a;
  $('setwho').textContent = a ? a.name : '';
  $('setkind').textContent = a ? (a.type === 'ms' ? 'Cuenta Microsoft (premium)' : 'Jugando sin cuenta') : '';
  $('play').disabled = S.busy || !a; $('update').disabled = S.busy;
  if (!a) openModal(false);
}
function openModal(cancel) { $('modal').hidden = false; $('mclose').hidden = !cancel; $('lerr').textContent = ''; }
function closeModal() { $('modal').hidden = true; }
async function afterLogin(acc) { S.account = acc; S.loaded = false; closeModal(); refreshAccount(); say('Todo listo.'); refreshMine(); }
$('ms').onclick = async () => {
  $('ms').disabled = true; $('lerr').textContent = 'Abriendo la ventana de Microsoft…';
  const r = await sarex.invoke('login-ms'); $('ms').disabled = false;
  if (r.ok) afterLogin({ type: 'ms', name: r.name }); else $('lerr').textContent = r.error;
};
$('offbtn').onclick = async () => {
  const r = await sarex.invoke('login-offline', $('offname').value);
  if (r.ok) afterLogin({ type: 'offline', name: r.name }); else $('lerr').textContent = r.error;
};
$('offname').onkeydown = e => { if (e.key === 'Enter') $('offbtn').click(); };
$('logout').onclick = async () => { await sarex.invoke('logout'); S.account = null; S.loaded = false; refreshAccount(); };
$('mclose').onclick = closeModal;

// ---------- Jugar / actualizar ----------
sarex.on('progress', p => { const n = Math.round(Math.min(1, p.pct || 0) * 100); $('prog').hidden = false; $('fill').style.width = n + '%'; $('pct').hidden = false; $('pct').textContent = n + '%'; say(p.text); });
sarex.on('busy', b => { S.busy = b; $('play').disabled = b || !S.account; $('update').disabled = b; $('playLbl').textContent = b ? 'PREPARANDO…' : 'JUGAR'; if (!b) { $('prog').hidden = true; $('pct').hidden = true; } });
sarex.on('game-started', () => say('Minecraft abrió. Buen juego.'));
sarex.on('game-closed', d => { $('prog').hidden = true; $('pct').hidden = true; if (d && d.code && !d.started) say('Minecraft se cerró al iniciar. En Seguridad, pulsa «Copiar registro seguro» y mándaselo a Sarex Studio.', true); else say('Listo para jugar otra vez.'); });
async function run(a) { const r = await sarex.invoke(a); if (!r.ok) say(r.error, true); }
$('play').onclick = () => run('play');
$('update').onclick = () => run('update');
$('folder').onclick = () => sarex.invoke('open-folder');
$('ram').oninput = e => { $('ramv').textContent = e.target.value + ' GB'; sarex.invoke('set-ram', +e.target.value); };

// ---------- Anuncios discretos ----------
function showAd(ads, i = 0) {
  clearTimeout(S.adTimer);
  if (!ads.length || S.adsOff) { $('ad').hidden = true; return; }
  const ad = ads[i % ads.length];
  $('ad').hidden = false; $('adtag').textContent = ad.tag || 'Patrocinado'; $('adtext').textContent = ad.text;
  $('adtext').onclick = e => { e.preventDefault(); if (ad.url) sarex.invoke('open-url', ad.url); };
  if (ads.length > 1) S.adTimer = setTimeout(() => showAd(ads, i + 1), 45000);
}
$('adclose').onclick = () => { S.adsOff = true; $('ad').hidden = true; };

// ---------- Inicio ----------
(async () => {
  const d = await sarex.invoke('init'), m = d.manifest;
  S.account = d.account;
  $('chipVer').textContent = 'Minecraft ' + d.cfg.minecraft;
  $('chipMods').textContent = m.mods + (m.mods === 1 ? ' mod' : ' mods');
  $('packinfo').textContent = m.offline ? 'Sin conexión con el pack: se usará lo ya instalado.' : `${m.packName || 'Pack'}: los mods se instalan y actualizan solos.`;
  $('ram').value = d.ram; $('ramv').textContent = d.ram + ' GB';
  initOpts(d);
  const nw = $('news'); nw.replaceChildren();
  for (const n of m.news.slice(0, 4)) { const a = el('article'); a.append(el('h4', '', n.title), el('p', '', n.text)); nw.append(a); }
  showAd(m.ads);
  refreshAccount(); if (S.account) { say('Todo listo.'); refreshMine(); }
})();


// ---------- Mods ----------
const badge = (t, k) => el('span', 'badge ' + k, t);
async function loadMods() {
  const r = await sarex.invoke('mods-status'), box = $('modlist'); box.replaceChildren();
  const L = { ok: ['Verificado', 'ok'], missing: ['Falta', 'warn'], bad: ['Dañado', 'bad'] };
  for (const m of r.mods) { const row = el('div', 'mrow'); row.append(el('span', '', m.file), badge(...L[m.state])); box.append(row); }
  const good = r.mods.filter(m => m.state === 'ok').length;
  $('modsum').textContent = r.mods.length ? `${good} de ${r.mods.length} mods verificados.` + (r.extra ? ` Hay ${r.extra} mod(s) ajenos que se quitarán al jugar.` : '') + (r.offline ? ' Sin conexión con el pack.' : '') : 'Aquí aparecerán los mods de tu pack.';
}
$('modfix').onclick = async () => { $('modfix').disabled = true; $('modsum').textContent = 'Verificando…'; const r = await sarex.invoke('update'); $('modfix').disabled = false; if (!r.ok) say(r.error, true); loadMods(); };
$('modfolder').onclick = () => sarex.invoke('open-folder');

// ---------- Seguridad y privacidad ----------
async function loadSecurity() {
  const [s, m] = await Promise.all([sarex.invoke('security'), sarex.invoke('mods-status')]);
  const allOk = m.mods.length === 0 || m.mods.every(x => x.state === 'ok');
  const rows = [
    s.encrypted ? ['ok', 'Sesión cifrada en tu equipo', 'Tu sesión de Microsoft nunca queda en texto plano.'] : ['warn', 'Cifrado no disponible', 'Tu sesión no se guardará: tendrás que entrar cada vez.'],
    s.sigFail ? ['bad', 'Lista de mods NO válida', 'La firma no coincide. No se instala nada por seguridad.'] : s.signed ? ['ok', 'Lista de mods firmada', 'Nadie puede añadir mods falsos sin la llave de Sarex Studio.'] : ['warn', 'Lista de mods sin firma', 'Funciona, pero el dueño debería activar la firma.'],
    allOk ? ['ok', 'Mods verificados', 'Cada archivo coincide con su huella digital.'] : ['warn', 'Hay mods por verificar', 'Ve a Mods y pulsa Verificar y reparar.'],
    ['ok', 'Descargas solo de sitios autorizados', s.hosts.join(', ')],
    ['ok', 'Sin recopilación de datos', 'El launcher no envía información tuya a nadie.']
  ];
  const ul = $('checks'); ul.replaceChildren();
  for (const [k, t, d] of rows) { const li = el('li'), dot = el('span', 'dot ' + k, k === 'ok' ? '✓' : '!'), box = el('div'); const b = el('b', '', t), sm = el('small', '', d); box.append(b, sm); li.append(dot, box); ul.append(li); }
}
function note(t, err) { $('secmsg').textContent = t; $('secmsg').style.color = err ? '' : 'var(--mut)'; }
$('copylog').onclick = async () => { const r = await sarex.invoke('copy-safe-log'); note(r.ok ? 'Copiado. Ya puedes pegarlo en el chat de ayuda.' : r.error, !r.ok); };
$('cleanlogs').onclick = async () => { await sarex.invoke('clean-logs'); note('Registros y reportes borrados.'); };
let wipeArm = null;
$('wipe').onclick = async () => {
  if (!wipeArm) { $('wipe').textContent = '¿Seguro? Pulsa otra vez para borrar'; wipeArm = setTimeout(() => { wipeArm = null; $('wipe').textContent = 'Borrar mis datos de este equipo'; }, 4000); return; }
  clearTimeout(wipeArm); await sarex.invoke('wipe'); location.reload();
};
$('ms2fa').onclick = () => sarex.invoke('open-url', 'https://account.microsoft.com/security');

// ---------- Opciones ----------
function applyPrivate(on) { document.body.classList.toggle('private', on); }
function initOpts(d) {
  $('optPrivate').checked = d.opts.private; applyPrivate(d.opts.private);
  $('optClose').checked = d.opts.closeOnPlay;
  $('optDisc').checked = d.opts.discord && d.discord.ready; $('optDisc').disabled = !d.discord.ready;
  if (!d.discord.ready) $('discSmall').textContent = 'Aún no está configurado: falta el ID de la aplicación de Discord en config.json.';
  if (d.discord.invite) { $('discJoin').hidden = false; $('discJoin').onclick = () => sarex.invoke('open-url', d.discord.invite); }
  if (d.cfg.server) { $('joinRow').hidden = false; $('optJoin').checked = d.opts.autoJoin; $('joinSrv').textContent = d.cfg.server.name || d.cfg.server.host; $('joinSrv').classList.add('pn');
    $('chipSrv').hidden = false; $('chipSrv').textContent = d.cfg.server.name || d.cfg.server.host; }
}
$('optPrivate').onchange = e => { applyPrivate(e.target.checked); sarex.invoke('set-opt', 'private', e.target.checked); };
$('optClose').onchange = e => sarex.invoke('set-opt', 'closeOnPlay', e.target.checked);
$('optDisc').onchange = e => sarex.invoke('set-opt', 'discord', e.target.checked);
$('optJoin').onchange = e => sarex.invoke('set-opt', 'autoJoin', e.target.checked);

// Fondo con ligero movimiento al mover el ratón
addEventListener('mousemove', e => { document.body.style.setProperty('--px', ((e.clientX / innerWidth - .5) * -14).toFixed(1) + 'px'); document.body.style.setProperty('--py', ((e.clientY / innerHeight - .5) * -10).toFixed(1) + 'px'); });
