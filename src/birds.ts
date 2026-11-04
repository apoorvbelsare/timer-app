/**
 * A small flock drifting slowly across the focus window. It's company, not
 * content: the solo stand-in for working alongside other people.
 */
export function startFlock(canvas: HTMLCanvasElement, color: string, count = 11): () => void {
  const ctx = canvas.getContext('2d')!;
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let width = 0;
  let height = 0;

  const resize = () => {
    const dpr = devicePixelRatio || 1;
    width = canvas.clientWidth;
    height = canvas.clientHeight;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  resize();
  window.addEventListener('resize', resize);

  const birds = Array.from({ length: count }, () => ({
    x: Math.random() * width,
    y: height * (0.15 + Math.random() * 0.4),
    vx: 0.5 + Math.random() * 0.4,
    vy: (Math.random() - 0.5) * 0.2,
    phase: Math.random() * Math.PI * 2,
    size: 5 + Math.random() * 4,
  }));

  const draw = (time: number) => {
    ctx.clearRect(0, 0, width, height);
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.6;
    ctx.lineCap = 'round';
    for (const b of birds) {
      const flap = Math.sin(time * 4.5 + b.phase) * 0.7;
      const s = b.size;
      ctx.beginPath();
      ctx.moveTo(b.x - s, b.y - s * flap);
      ctx.quadraticCurveTo(b.x - s * 0.4, b.y - s * 0.25, b.x, b.y);
      ctx.quadraticCurveTo(b.x + s * 0.4, b.y - s * 0.25, b.x + s, b.y - s * flap);
      ctx.stroke();
    }
  };

  const step = (time: number) => {
    // The flock's centre wanders on a slow loop, so the birds never settle
    const cx = width * (0.5 + 0.4 * Math.sin(time * 0.04));
    const cy = height * (0.32 + 0.14 * Math.sin(time * 0.07 + 1));
    for (const b of birds) {
      let ax = (cx - b.x) * 0.00012;
      let ay = (cy - b.y) * 0.00025;
      for (const other of birds) {
        if (other === b) continue;
        const dx = b.x - other.x;
        const dy = b.y - other.y;
        const d2 = dx * dx + dy * dy;
        if (d2 > 0 && d2 < 1200) {
          ax += (dx / d2) * 0.08;
          ay += (dy / d2) * 0.08;
        }
      }
      b.vx += ax;
      b.vy += ay;
      const speed = Math.hypot(b.vx, b.vy);
      const clamped = Math.min(1.1, Math.max(0.35, speed));
      b.vx = (b.vx / speed) * clamped;
      b.vy = (b.vy / speed) * clamped;
      b.x += b.vx;
      b.y += b.vy;
      if (b.x > width + 20) b.x = -20;
      if (b.x < -20) b.x = width + 20;
    }
  };

  if (still) {
    draw(0);
    return () => window.removeEventListener('resize', resize);
  }

  let raf = 0;
  let last = 0;
  const frame = (now: number) => {
    raf = requestAnimationFrame(frame);
    // ~30 fps is plenty for drifting birds and keeps the CPU quiet
    if (document.hidden || now - last < 33) return;
    last = now;
    const time = now / 1000;
    step(time);
    draw(time);
  };
  raf = requestAnimationFrame(frame);

  return () => {
    cancelAnimationFrame(raf);
    window.removeEventListener('resize', resize);
  };
}
