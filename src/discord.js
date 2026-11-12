// Estado de Discord (Rich Presence) sin dependencias: habla directamente con la app de Discord de tu PC.
// Solo envía el nombre del juego y la hora de inicio. Nunca tu nombre de cuenta, IP ni servidor.
const net = require('net'), path = require('path'), crypto = require('crypto');
const frame = (op, data) => { const j = Buffer.from(JSON.stringify(data)); const b = Buffer.alloc(8 + j.length); b.writeInt32LE(op, 0); b.writeInt32LE(j.length, 4); j.copy(b, 8); return b; };
const pipes = () => Array.from({ length: 10 }, (_, i) => process.platform === 'win32' ? `\\\\?\\pipe\\discord-ipc-${i}`
  : path.join(process.env.XDG_RUNTIME_DIR || process.env.TMPDIR || '/tmp', `discord-ipc-${i}`));
class Presence {
  constructor(clientId) { this.id = clientId; this.sock = null; this.ready = false; }
  async connect() {
    if (!/^\d{15,25}$/.test(this.id || '')) return false;
    for (const p of pipes()) {
      try { this.sock = await new Promise((ok, no) => { const s = net.createConnection(p); s.once('connect', () => ok(s)); s.once('error', no); }); break; } catch {}
    }
    if (!this.sock) return false;
    this.sock.on('error', () => { this.ready = false; this.sock = null; }); this.sock.on('close', () => { this.ready = false; this.sock = null; });
    this.sock.on('data', d => { if (String(d).includes('"READY"')) this.ready = true; });
    this.sock.write(frame(0, { v: 1, client_id: this.id }));
    for (let i = 0; i < 30 && !this.ready; i++) await new Promise(r => setTimeout(r, 100));
    return this.ready;
  }
  set(activity) { if (this.sock && this.ready) this.sock.write(frame(1, { cmd: 'SET_ACTIVITY', args: { pid: process.pid, activity }, nonce: crypto.randomUUID() })); }
  clear() { this.set(undefined); }
  close() { try { this.clear(); this.sock && this.sock.end(); } catch {} this.sock = null; this.ready = false; }
}
module.exports = { Presence, frame };
