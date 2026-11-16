/* PAM Word Challenge — sound (Web Audio, no files) + confetti */
window.Sound = (() => {
  'use strict';
  let ctx = null;
  const S = { enabled: true };

  function ac() {
    if (!ctx) {
      const C = window.AudioContext || window.webkitAudioContext;
      if (!C) return null;
      ctx = new C();
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  function tone(freq, dur = 0.12, type = 'sine', vol = 0.06, delay = 0, slide = 0) {
    if (!S.enabled) return;
    const c = ac(); if (!c) return;
    const t0 = c.currentTime + delay;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    if (slide) o.frequency.exponentialRampToValueAtTime(freq * slide, t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(c.destination);
    o.start(t0);
    o.stop(t0 + dur + 0.03);
  }

  S.unlock = () => { if (S.enabled) ac(); };
  S.tap    = () => tone(520, 0.05, 'sine', 0.03);
  S.key    = () => tone(700, 0.045, 'triangle', 0.03);
  S.del    = () => tone(420, 0.05, 'triangle', 0.03);
  S.flip   = st => tone(st === 'correct' ? 880 : st === 'present' ? 660 : 300, 0.13, 'sine', 0.05);
  S.error  = () => { tone(190, 0.12, 'square', 0.025); tone(150, 0.16, 'square', 0.025, 0.09); };
  S.win    = () => [523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, 0.28, 'triangle', 0.06, i * 0.09));
  S.lose   = () => [392, 330, 262].forEach((f, i) => tone(f, 0.32, 'sine', 0.055, i * 0.17));
  S.tick   = () => tone(1200, 0.03, 'square', 0.015);
  return S;
})();

window.Confetti = (() => {
  'use strict';
  const COLORS = ['#f6dc96', '#d6ad55', '#12b886', '#3ee0c0', '#ffffff', '#5b9bff', '#f0a92c'];
  let parts = [], raf = null, ctx = null, W = 0, H = 0, dpr = 1;

  function canvas() { return document.getElementById('confetti'); }

  function resize() {
    const c = canvas();
    dpr = Math.min(2, window.devicePixelRatio || 1);
    W = c.width = Math.round(innerWidth * dpr);
    H = c.height = Math.round(innerHeight * dpr);
  }

  function burst(n = 260) {
    const c = canvas(); if (!c) return;
    ctx = c.getContext('2d');
    resize();
    for (let i = 0; i < n; i++) {
      const left = i % 2 === 0;
      parts.push({
        x: left ? -10 : W + 10,
        y: H * (0.55 + Math.random() * 0.2),
        vx: (left ? 1 : -1) * (5 + Math.random() * 13) * dpr,
        vy: -(14 + Math.random() * 18) * dpr,
        w: (7 + Math.random() * 7) * dpr,
        h: (11 + Math.random() * 9) * dpr,
        r: Math.random() * Math.PI * 2,
        vr: (Math.random() - 0.5) * 0.32,
        c: COLORS[i % COLORS.length],
        life: 0,
        round: Math.random() < 0.25
      });
    }
    if (!raf) raf = requestAnimationFrame(loop);
  }

  function loop() {
    ctx.clearRect(0, 0, W, H);
    parts = parts.filter(p => p.y < H + 60 && p.life < 520);
    for (const p of parts) {
      p.life++;
      p.vy = Math.min(p.vy + 0.42 * dpr, 4.2 * dpr);
      p.vx *= 0.985;
      p.x += p.vx + Math.sin(p.life * 0.06) * 0.8 * dpr;
      p.y += p.vy;
      p.r += p.vr;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.r);
      ctx.fillStyle = p.c;
      ctx.globalAlpha = Math.min(1, (520 - p.life) / 80);
      if (p.round) { ctx.beginPath(); ctx.arc(0, 0, p.w / 2, 0, Math.PI * 2); ctx.fill(); }
      else ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h * Math.abs(Math.cos(p.life * 0.09)));
      ctx.restore();
    }
    if (parts.length) raf = requestAnimationFrame(loop);
    else { ctx.clearRect(0, 0, W, H); raf = null; }
  }

  return { burst };
})();
