// Firma tu manifest para que NADIE (ni siquiera alguien que hackee tu GitHub) pueda meter mods falsos.
//   1) node tools/sign-manifest.js keygen   -> crea sarex-private.pem y muestra la publicKey para config.json
//   2) node tools/sign-manifest.js sign     -> crea manifest.json.sig (súbelo junto a manifest.json)
const crypto = require('crypto'), fs = require('fs');
const cmd = process.argv[2];
if (cmd === 'keygen') {
  if (fs.existsSync('sarex-private.pem')) { console.log('Ya existe sarex-private.pem. No lo sobrescribo.'); process.exit(1); }
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  fs.writeFileSync('sarex-private.pem', privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
  console.log('\npublicKey para pegar en config.json:\n\n' + publicKey.export({ type: 'spki', format: 'der' }).toString('base64'));
  console.log('\nGuarda sarex-private.pem fuera de GitHub (pendrive o carpeta privada). NUNCA lo subas ni lo compartas.');
} else if (cmd === 'sign') {
  const key = crypto.createPrivateKey(fs.readFileSync('sarex-private.pem'));
  fs.writeFileSync('manifest.json.sig', crypto.sign(null, fs.readFileSync('manifest.json'), key).toString('base64'));
  console.log('Listo. Sube manifest.json y manifest.json.sig a tu repo.');
} else console.log('Uso: node tools/sign-manifest.js keygen | sign');
