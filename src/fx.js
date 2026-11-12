(() => {
  const c = document.getElementById('fx'); if (!c || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const g = c.getContext('2d'); let w, h, ps = [];
  const size = () => { w = c.width = innerWidth; h = c.height = innerHeight; };
  const mk = (init) => ({ x: Math.random() * w, y: init ? Math.random() * h : h + 10, r: Math.random() * 1.8 + .4, v: Math.random() * .35 + .1, a: Math.random() * .5 + .15, d: Math.random() * 6.28, hue: [38, 24, 330, 270][Math.floor(Math.random() * 4)] });
  size(); addEventListener('resize', size);
  for (let i = 0; i < 46; i++) ps.push(mk(true));
  (function tick() {
    g.clearRect(0, 0, w, h);
    for (const p of ps) {
      p.y -= p.v; p.d += .01; p.x += Math.sin(p.d) * .25;
      if (p.y < -10) Object.assign(p, mk(false));
      g.beginPath(); g.fillStyle = `hsla(${p.hue},100%,65%,${p.a})`; g.shadowColor = `hsla(${p.hue},100%,60%,.8)`; g.shadowBlur = 8; g.arc(p.x, p.y, p.r, 0, 6.283); g.fill();
    }
    requestAnimationFrame(tick);
  })();
})();
