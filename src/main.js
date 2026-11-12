const { app, BrowserWindow, ipcMain, shell, safeStorage, dialog, session, clipboard, Tray, Menu, nativeImage } = require('electron');
const path = require('path'), fs = require('fs'), crypto = require('crypto'), os = require('os');
const { execFileSync } = require('child_process');
const { Client, Authenticator } = require('minecraft-launcher-core');
const { Auth } = require('msmc');
const { Presence } = require('./discord');

app.enableSandbox();
app.setAppUserModelId('studio.sarex.launcher');
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();
app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
// Solo la ventana del launcher puede hablar con el proceso principal.
const trusted = e => { try { return e.senderFrame.url.startsWith('file://') && /\/src\/index\.html$/.test(e.senderFrame.url.split('?')[0]); } catch { return false; } };
const handle = (ch, fn) => ipcMain.handle(ch, (e, ...a) => trusted(e) ? fn(e, ...a) : Promise.reject(new Error('No autorizado')));
const CFG = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config.json'), 'utf8'));
const ROOT = path.join(app.getPath('appData'), '.sarexstudio');
const SETTINGS = path.join(ROOT, 'launcher.json');
const SKIN_DIR = path.join(ROOT, 'skins');
const CSL_DIR = path.join(ROOT, 'CustomSkinLoader', 'LocalSkin', 'skins');
const MCACHE = path.join(ROOT, 'manifest.cache.json');
const ICON = path.join(__dirname, '..', 'assets', 'icon.png');
let win, splash, tray, presence = null, hiddenToTray = false, busy = false, manifest = null, memToken = null;

// ---------- Utilidades de seguridad ----------
const okUrl = u => { try { return new URL(u).protocol === 'https:'; } catch { return false; } };
const okHost = u => okUrl(u) && (CFG.allowedHosts || []).includes(new URL(u).hostname);
const okPlayer = n => /^[A-Za-z0-9_]{3,16}$/.test(n || '');
const okJar = f => typeof f === 'string' && f === path.basename(f) && /^[\w.+\-() \[\]]+\.jar$/i.test(f);
const sha1 = f => crypto.createHash('sha1').update(fs.readFileSync(f)).digest('hex');
const dataUrl = b => 'data:image/png;base64,' + b.toString('base64');
const validSkin = b => b.length > 24 && b.length < 200 * 1024 && b.readUInt32BE(0) === 0x89504e47 &&
  b.readUInt32BE(16) === 64 && (b.readUInt32BE(20) === 64 || b.readUInt32BE(20) === 32);

// La sesión de Microsoft nunca se guarda en texto plano: se cifra con el sistema (DPAPI en Windows).
const enc = t => safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(t).toString('base64') : null;
const dec = e => safeStorage.decryptString(Buffer.from(e, 'base64'));

function saveSettings(s) { fs.mkdirSync(ROOT, { recursive: true }); fs.writeFileSync(SETTINGS, JSON.stringify(s, null, 2)); }
function readSettings() {
  let s; try { s = JSON.parse(fs.readFileSync(SETTINGS, 'utf8')); } catch { s = { ram: 4 }; }
  if (s.account && s.account.token) { // migrar versiones anteriores que guardaban el token sin cifrar
    const e = enc(s.account.token); delete s.account.token;
    if (e) s.account.enc = e; else delete s.account;
    saveSettings(s);
  }
  return s;
}
const send = (ch, d) => win && !win.isDestroyed() && win.webContents.send(ch, d);
const status = (text, pct) => send('progress', { text, pct });

async function download(url, dest, onBytes) {
  if (!okUrl(url)) throw new Error('Enlace no seguro (debe ser https): ' + url);
  const r = await fetch(url, { redirect: 'follow' });
  if (!r.ok) throw new Error(`No se pudo descargar (${r.status}): ${url}`);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const total = +r.headers.get('content-length') || 0; let got = 0;
  const ws = fs.createWriteStream(dest), rd = r.body.getReader();
  for (;;) { const { done, value } = await rd.read(); if (done) break; ws.write(value); got += value.length; onBytes && onBytes(got, total); }
  await new Promise(res => ws.end(res));
}

function verifySig(buf, sig) {
  try { return crypto.verify(null, buf, crypto.createPublicKey({ key: Buffer.from(CFG.publicKey, 'base64'), format: 'der', type: 'spki' }), Buffer.from(String(sig).trim(), 'base64')); }
  catch { return false; }
}
async function loadManifest() {
  const signed = !!CFG.publicKey;
  try {
    const r = await fetch(CFG.manifestUrl, { cache: 'no-store' });
    if (!r.ok) throw new Error(r.status);
    const buf = Buffer.from(await r.arrayBuffer()); let sig = '';
    if (signed) {
      const rs = await fetch(CFG.manifestUrl + '.sig', { cache: 'no-store' }); sig = rs.ok ? await rs.text() : '';
      if (!verifySig(buf, sig)) { manifest = { mods: [], news: [], ads: [], skins: [], _sigFail: true, _signed: true }; return manifest; }
    }
    manifest = JSON.parse(buf.toString('utf8')); manifest._signed = signed;
    fs.mkdirSync(ROOT, { recursive: true }); fs.writeFileSync(MCACHE, JSON.stringify({ text: buf.toString('base64'), sig }));
  } catch {
    try {
      const c = JSON.parse(fs.readFileSync(MCACHE, 'utf8')), buf = Buffer.from(c.text, 'base64');
      if (signed && !verifySig(buf, c.sig)) throw 0;
      manifest = JSON.parse(buf.toString('utf8')); manifest._signed = signed; manifest._offline = true; manifest._cached = true;
    } catch {
      manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'manifest.local.json'), 'utf8')); manifest._offline = true;
    }
  }
  return manifest;
}

// ---------- Java 21 (con verificación SHA-256) ----------
function findJava(dir) {
  const exe = process.platform === 'win32' ? 'javaw.exe' : 'java';
  const walk = d => { for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) { const f = walk(p); if (f) return f; }
    else if (e.name === exe && path.basename(d) === 'bin') return p; } };
  return fs.existsSync(dir) ? walk(dir) : null;
}
async function ensureJava() {
  const dir = path.join(ROOT, 'runtime');
  let j = findJava(dir); if (j) return j;
  const os = { win32: 'windows', darwin: 'mac', linux: 'linux' }[process.platform];
  const arch = process.arch === 'arm64' ? 'aarch64' : 'x64';
  const meta = await (await fetch(`https://api.adoptium.net/v3/assets/latest/21/hotspot?architecture=${arch}&image_type=jre&os=${os}&vendor=eclipse`)).json();
  const pkg = meta[0].binary.package;
  const file = path.join(ROOT, pkg.name);
  await download(pkg.link, file, (g, t) => status('Descargando Java 21', t ? g / t * 0.4 : 0));
  const h = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  if (h !== pkg.checksum) { fs.unlinkSync(file); throw new Error('La descarga de Java llegó dañada. Inténtalo de nuevo.'); }
  status('Instalando Java 21', 0.4); fs.mkdirSync(dir, { recursive: true });
  execFileSync('tar', ['-xf', file, '-C', dir]); fs.unlinkSync(file);
  j = findJava(dir); if (!j) throw new Error('No se pudo instalar Java 21.');
  if (process.platform !== 'win32') fs.chmodSync(j, 0o755);
  return j;
}

// ---------- Fabric ----------
const mavenPath = n => { const [g, a, v] = n.split(':'); return `${g.replace(/\./g, '/')}/${a}/${v}/${a}-${v}.jar`; };
async function ensureFabric() {
  const s = readSettings(); let profile;
  try {
    const list = await (await fetch(`https://meta.fabricmc.net/v2/versions/loader/${CFG.minecraft}`)).json();
    const loader = (list.find(l => l.loader.stable) || list[0]).loader.version;
    profile = await (await fetch(`https://meta.fabricmc.net/v2/versions/loader/${CFG.minecraft}/${loader}/profile/json`)).json();
  } catch (e) {
    if (s.fabricId && fs.existsSync(path.join(ROOT, 'versions', s.fabricId, s.fabricId + '.json'))) return s.fabricId;
    throw new Error('No hay conexión para descargar Fabric.');
  }
  const id = profile.id, vdir = path.join(ROOT, 'versions', id);
  fs.mkdirSync(vdir, { recursive: true });
  fs.writeFileSync(path.join(vdir, id + '.json'), JSON.stringify(profile, null, 2));
  const libs = profile.libraries.filter(l => l.url);
  for (let i = 0; i < libs.length; i++) {
    const L = libs[i], rel = mavenPath(L.name), dest = path.join(ROOT, 'libraries', rel);
    status('Instalando Fabric', i / libs.length);
    if (!fs.existsSync(dest) || (L.sha1 && sha1(dest) !== L.sha1)) {
      await download(L.url.replace(/\/?$/, '/') + rel, dest);
      if (L.sha1 && sha1(dest) !== L.sha1) { fs.unlinkSync(dest); throw new Error(`La librería ${L.name} llegó dañada.`); }
    }
  }
  saveSettings({ ...readSettings(), fabricId: id });
  return id;
}

// ---------- Mods (nombre válido, https y sha1 obligatorios) ----------
async function syncMods() {
  const dir = path.join(ROOT, 'mods'); fs.mkdirSync(dir, { recursive: true });
  const mods = manifest.mods || [];
  for (const m of mods) if (!okJar(m.file) || !okHost(m.url) || !/^[a-f0-9]{40}$/i.test(m.sha1 || ''))
    throw new Error(`Mod rechazado (${m.file}): debe ser .jar, venir de un sitio autorizado por https y tener sha1.`);
  for (let i = 0; i < mods.length; i++) {
    const m = mods[i], dest = path.join(dir, m.file);
    status(`Mods ${i + 1}/${mods.length}: ${m.file}`, i / Math.max(mods.length, 1));
    if (fs.existsSync(dest) && sha1(dest) === m.sha1.toLowerCase()) continue;
    await download(m.url, dest, (g, t) => t && status(`Mods ${i + 1}/${mods.length}: ${m.file}`, (i + g / t) / mods.length));
    if (sha1(dest) !== m.sha1.toLowerCase()) { fs.unlinkSync(dest); throw new Error(`El mod ${m.file} llegó dañado o fue modificado.`); }
  }
  if (manifest.strict) {
    const keep = new Set(mods.map(m => m.file));
    for (const f of fs.readdirSync(dir)) if (f.endsWith('.jar') && !keep.has(f)) fs.unlinkSync(path.join(dir, f));
  }
}

// ---------- Skins (premium y no premium) ----------
async function premiumSkin(name) {
  if (!okPlayer(name)) throw new Error('Nombre no válido.');
  const p = await fetch(`https://api.mojang.com/users/profiles/minecraft/${name}`);
  if (p.status === 204 || p.status === 404) throw new Error('Ese jugador premium no existe.');
  if (!p.ok) throw new Error('Mojang no respondió. Prueba en un momento.');
  const { id } = await p.json();
  const s = await (await fetch(`https://sessionserver.mojang.com/session/minecraft/profile/${id}`)).json();
  const tex = JSON.parse(Buffer.from(s.properties.find(x => x.name === 'textures').value, 'base64').toString());
  const sk = tex.textures && tex.textures.SKIN;
  if (!sk || !sk.url.startsWith('https://textures.minecraft.net/')) throw new Error('Ese jugador no tiene skin propia.');
  const b = Buffer.from(await (await fetch(sk.url)).arrayBuffer());
  if (!validSkin(b)) throw new Error('Skin no compatible.');
  return { data: dataUrl(b), slim: !!(sk.metadata && sk.metadata.model === 'slim') };
}
async function fetchPng(url) {
  if (!okHost(url)) throw new Error('Enlace no autorizado');
  const r = await fetch(url, { redirect: 'follow' }); if (!r.ok) throw new Error(r.status);
  const b = Buffer.from(await r.arrayBuffer()); if (!validSkin(b)) throw new Error('Skin no válida');
  return b;
}
async function syncSkins(name) { // deja las skins de todos los amigos donde CustomSkinLoader las lee
  fs.mkdirSync(CSL_DIR, { recursive: true });
  for (const s of (manifest.skins || []).slice(0, 60)) {
    if (!okPlayer(s.player)) continue;
    try { fs.writeFileSync(path.join(CSL_DIR, s.player + '.png'), await fetchPng(s.url)); } catch {}
  }
  const mine = path.join(SKIN_DIR, 'mine.png');
  if (okPlayer(name) && fs.existsSync(mine)) fs.copyFileSync(mine, path.join(CSL_DIR, name + '.png'));
}

// ---------- Cuenta ----------
async function getAuth() {
  const s = readSettings(), a = s.account;
  if (a && a.type === 'ms') {
    const token = memToken || (a.enc ? dec(a.enc) : null);
    if (!token) throw new Error('Vuelve a iniciar sesión con Microsoft.');
    const mc = await (await new Auth('select_account').refresh(token)).getMinecraft();
    return mc.mclc();
  }
  if (a && a.type === 'offline') return Authenticator.getAuth(a.name);
  throw new Error('Inicia sesión primero.');
}

function ensurePack() { // logo "Sarex Studio" en la pantalla de carga (requiere el mod Puzzle)
  const dir = path.join(ROOT, 'resourcepacks'); fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'SarexStudio-Pack.zip'), fs.readFileSync(path.join(__dirname, '..', 'assets', 'SarexStudio-Pack.zip')));
  const f = path.join(ROOT, 'options.txt'); let t = ''; try { t = fs.readFileSync(f, 'utf8'); } catch {}
  const entry = 'file/SarexStudio-Pack.zip', m = t.match(/^resourcePacks:(\[.*\])\s*$/m);
  if (m) { try { const arr = JSON.parse(m[1]); if (!arr.includes(entry)) { arr.push(entry); t = t.replace(m[0], 'resourcePacks:' + JSON.stringify(arr)); } } catch {} }
  else t += (t && !t.endsWith('\n') ? '\n' : '') + `resourcePacks:["vanilla","${entry}"]\n`;
  fs.writeFileSync(f, t);
}
async function install() {
  if (manifest._sigFail) throw new Error('La lista de mods no tiene una firma válida. Por seguridad no se instaló nada. Avisa a Sarex Studio.');
  const java = await ensureJava();
  const fabric = await ensureFabric();
  if (!(manifest._offline && !manifest._cached)) await syncMods(); // sin conexión ni caché: no se toca nada
  ensurePack();
  return { java, fabric };
}
async function guard(fn) {
  if (busy) return { ok: false, error: 'Ya hay una tarea en curso.' };
  busy = true; send('busy', true);
  try { await fn(); return { ok: true }; }
  catch (e) { return { ok: false, error: e.message }; }
  finally { busy = false; send('busy', false); }
}

handle('init', async () => {
  const m = await loadManifest(), s = readSettings(), a = s.account;
  const usable = a && (a.type === 'offline' || memToken || a.enc);
  return { cfg: { minecraft: CFG.minecraft, server: CFG.server && CFG.server.host ? CFG.server : null },
    manifest: { packName: m.packName, news: m.news || [], ads: m.ads || [], mods: (m.mods || []).length, offline: !!m._offline, sigFail: !!m._sigFail },
    ram: s.ram || 4, opts: { private: !!s.private, closeOnPlay: s.closeOnPlay !== false, autoJoin: !!s.autoJoin, discord: s.discord !== false },
    discord: { ready: !!(CFG.discord && CFG.discord.clientId), invite: okUrl(CFG.discord && CFG.discord.invite) ? CFG.discord.invite : '' },
    account: usable ? { type: a.type, name: a.name } : null };
});
handle('login-ms', async () => {
  try {
    const xbox = await new Auth('select_account').launch('electron'), mc = await xbox.getMinecraft();
    const token = xbox.save(), name = mc.profile.name; memToken = token;
    saveSettings({ ...readSettings(), account: { type: 'ms', name, enc: enc(token) || undefined } });
    return { ok: true, name };
  } catch { return { ok: false, error: 'No se pudo iniciar sesión con Microsoft.' }; }
});
handle('login-offline', (_e, name) => {
  name = String(name || '').trim();
  if (!okPlayer(name)) return { ok: false, error: 'Usa 3 a 16 letras, números o guion bajo.' };
  memToken = null; saveSettings({ ...readSettings(), account: { type: 'offline', name } }); return { ok: true, name };
});
handle('logout', () => { memToken = null; const s = readSettings(); delete s.account; saveSettings(s); return true; });
handle('set-ram', (_e, gb) => { gb = Math.min(16, Math.max(2, parseInt(gb) || 4)); saveSettings({ ...readSettings(), ram: gb }); return true; });
handle('open-folder', () => shell.openPath(ROOT));
handle('open-url', (_e, u) => okUrl(u) && shell.openExternal(u));

handle('skin-mine', async () => {
  const s = readSettings(), mine = path.join(SKIN_DIR, 'mine.png');
  if (fs.existsSync(mine)) return { data: dataUrl(fs.readFileSync(mine)), source: 'local' };
  if (s.account && s.account.type === 'ms') { try { const r = await premiumSkin(s.account.name); return { ...r, source: 'premium' }; } catch {} }
  return { data: null, source: 'default' };
});
handle('skin-lookup', async (_e, name) => { try { return { ok: true, ...(await premiumSkin(String(name).trim())) }; } catch (e) { return { ok: false, error: e.message }; } });
handle('skin-import', async () => {
  const r = await dialog.showOpenDialog(win, { title: 'Elige tu skin (.png)', filters: [{ name: 'Skin PNG', extensions: ['png'] }], properties: ['openFile'] });
  if (r.canceled) return { ok: false, canceled: true };
  const f = r.filePaths[0];
  if (fs.statSync(f).size > 200 * 1024) return { ok: false, error: 'La skin pesa demasiado.' };
  const b = fs.readFileSync(f);
  if (!validSkin(b)) return { ok: false, error: 'La skin debe ser un PNG de 64x64 o 64x32.' };
  fs.mkdirSync(SKIN_DIR, { recursive: true }); fs.writeFileSync(path.join(SKIN_DIR, 'mine.png'), b);
  return { ok: true, data: dataUrl(b) };
});
handle('skin-remove', () => {
  const a = readSettings().account;
  try { fs.unlinkSync(path.join(SKIN_DIR, 'mine.png')); } catch {}
  if (a && okPlayer(a.name)) try { fs.unlinkSync(path.join(CSL_DIR, a.name + '.png')); } catch {}
  return true;
});
handle('skin-gallery', async () => {
  const list = (manifest && manifest.skins || []).filter(s => okPlayer(s.player)).slice(0, 40);
  const res = await Promise.allSettled(list.map(async s => ({ player: s.player, data: dataUrl(await fetchPng(s.url)) })));
  return res.filter(r => r.status === 'fulfilled').map(r => r.value);
});

handle('set-opt', (_e, k, v) => { if (!['private', 'closeOnPlay', 'autoJoin', 'discord'].includes(k)) return false; saveSettings({ ...readSettings(), [k]: !!v }); return true; });
handle('security', () => ({
  encrypted: safeStorage.isEncryptionAvailable(), signed: !!CFG.publicKey, sigFail: !!(manifest && manifest._sigFail),
  offline: !!(manifest && manifest._offline), strict: !!(manifest && manifest.strict), hosts: CFG.allowedHosts || [] }));
handle('mods-status', () => {
  const dir = path.join(ROOT, 'mods'), list = (manifest && manifest.mods || []).filter(m => okJar(m.file));
  const mods = list.map(m => { const p = path.join(dir, m.file); let st = 'missing';
    if (fs.existsSync(p)) st = m.sha1 && sha1(p) === String(m.sha1).toLowerCase() ? 'ok' : 'bad'; return { file: m.file, state: st }; });
  const known = new Set(list.map(m => m.file));
  const extra = fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => f.endsWith('.jar') && !known.has(f)).length : 0;
  return { mods, extra, offline: !!(manifest && manifest._offline) };
});
function redact(t) { // quita datos personales de un registro antes de compartirlo
  const a = readSettings().account;
  for (const w of [os.userInfo().username, os.hostname(), a && a.name]) if (w && w.length >= 3) t = t.split(w).join('[oculto]');
  return t
    .replace(/\beyJ[\w-]{10,}\.[\w-]{10,}\.[\w-]{10,}/g, '[token]')
    .replace(/(--(?:accessToken|uuid|xuid|clientId)\s+)\S+/gi, '$1[oculto]')
    .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, '[ip]')
    .replace(/\b(?:[A-Fa-f0-9]{1,4}:){2,7}[A-Fa-f0-9]{1,4}\b/g, '[ip]')
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[correo]')
    .replace(/\b[a-f0-9]{8}-?[a-f0-9]{4}-?[a-f0-9]{4}-?[a-f0-9]{4}-?[a-f0-9]{12}\b/gi, '[id]');
}
handle('copy-safe-log', () => {
  const p = path.join(ROOT, 'logs', 'latest.log');
  if (!fs.existsSync(p)) return { ok: false, error: 'Aún no hay registros. Juega una vez primero.' };
  clipboard.writeText(redact(fs.readFileSync(p, 'utf8').split(/\r?\n/).slice(-400).join('\n'))); return { ok: true };
});
const rm = p => fs.rmSync(p, { recursive: true, force: true });
handle('clean-logs', () => { rm(path.join(ROOT, 'logs')); rm(path.join(ROOT, 'crash-reports')); return true; });
handle('wipe', () => { // borra todo rastro personal de este equipo (no toca el juego ni los mods)
  memToken = null; for (const p of [SETTINGS, SKIN_DIR, path.join(ROOT, 'CustomSkinLoader'), path.join(ROOT, 'logs'), path.join(ROOT, 'crash-reports')]) rm(p);
  return true;
});
handle('update', () => guard(async () => { await loadManifest(); await install(); status('Todo al día', 1); }));
handle('play', () => guard(async () => {
  const auth = await getAuth(); await loadManifest();
  const { java, fabric } = await install();
  status('Preparando skins', 1); await syncSkins(readSettings().account.name);
  const ram = readSettings().ram || 4, mc = new Client();
  let started = false;
  const opened = async () => { // el juego ya abrió: estado de Discord y despedida del launcher
    if (started) return; started = true; send('game-started');
    const st = readSettings(), closing = st.closeOnPlay !== false;
    if (st.discord !== false && CFG.discord && CFG.discord.clientId) {
      const rpc = new Presence(CFG.discord.clientId);
      if (await rpc.connect()) {
        rpc.set({ details: 'Jugando SarexSafio 4', state: `Minecraft ${CFG.minecraft} con Fabric`, timestamps: { start: Date.now() },
          assets: { large_image: 'logo', large_text: 'Sarex Studio' },
          ...(okUrl(CFG.discord.invite) ? { buttons: [{ label: 'Unirse al Discord', url: CFG.discord.invite }] } : {}) });
        presence = rpc;
      }
    }
    if (!closing) { win.minimize(); return; }
    if (presence) { // se queda en segundo plano (bandeja) para mantener el estado mientras juegas
      hiddenToTray = true; win.hide();
      tray = new Tray(nativeImage.createFromPath(ICON).resize({ width: 16, height: 16 })); tray.setToolTip('Sarex Studio Launcher: jugando SarexSafio 4');
      tray.setContextMenu(Menu.buildFromTemplate([{ label: 'Mostrar launcher', click: () => { win.show(); } }, { label: 'Salir', click: () => app.quit() }]));
    } else setTimeout(() => app.quit(), 1800);
  };
  mc.on('progress', e => e.total && status('Descargando Minecraft', e.task / e.total));
  mc.on('data', d => { if (/Setting user:|LWJGL version|Backend library/.test(String(d))) opened(); });
  mc.on('close', code => {
    if (presence) { presence.close(); presence = null; }
    if (hiddenToTray) { app.quit(); return; }
    send('game-closed', { code, started }); if (win && !win.isDestroyed()) win.show();
  });
  // No se reenvían los registros del lanzamiento: contienen el token de acceso.
  status('Abriendo Minecraft…', 1);
  const proc = await mc.launch({
    authorization: auth, root: ROOT, javaPath: java,
    version: { number: CFG.minecraft, type: 'release', custom: fabric },
    memory: { max: `${ram}G`, min: '2G' },
    overrides: { detached: true },
    ...(readSettings().autoJoin && CFG.server && CFG.server.host ? { server: { host: CFG.server.host, port: String(CFG.server.port || 25565) } } : {})
  });
  if (!proc) throw new Error('Minecraft no pudo arrancar.');
  setTimeout(() => { if (proc.exitCode === null) opened(); }, 40000); // respaldo si no detectamos la línea de inicio
}));
handle('win-ctl', (_e, a) => { if (a === 'min') win.minimize(); if (a === 'close') win.close(); });

// ---------- Ventanas ----------
const secure = extra => ({ contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true, devTools: !app.isPackaged, ...extra });
function lock(w) {
  w.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  w.webContents.on('will-navigate', e => e.preventDefault());
}
app.whenReady().then(() => {
  if (!gotLock) return;
  session.defaultSession.setPermissionRequestHandler((_w, _p, cb) => cb(false));
  splash = new BrowserWindow({ width: 640, height: 380, frame: false, resizable: false, show: false, skipTaskbar: true, alwaysOnTop: true,
    backgroundColor: '#0b0610', icon: ICON, webPreferences: secure() });
  lock(splash); splash.loadFile(path.join(__dirname, 'splash.html')); splash.once('ready-to-show', () => splash.show());

  win = new BrowserWindow({ width: 1120, height: 700, minWidth: 960, minHeight: 620, frame: false, show: false, backgroundColor: '#12081a', icon: ICON,
    webPreferences: secure({ preload: path.join(__dirname, 'preload.js') }) });
  lock(win); win.setMenuBarVisibility(false);
  win.loadFile(path.join(__dirname, 'index.html'));
  const t0 = Date.now(), fade = (w, from, to, ms, done) => { let i = 0; const n = 12, t = setInterval(() => { i++; try { w.setOpacity(from + (to - from) * i / n); } catch {} if (i >= n) { clearInterval(t); done && done(); } }, ms / n); };
  win.once('ready-to-show', () => setTimeout(() => {
    fade(splash, 1, 0, 380, () => { if (!splash.isDestroyed()) splash.destroy(); win.setOpacity(0); win.show(); fade(win, 0, 1, 350); });
  }, Math.max(0, 3300 - (Date.now() - t0))));
});
app.on('before-quit', () => { if (presence) presence.close(); });
app.on('window-all-closed', () => { if (!hiddenToTray) app.quit(); });
