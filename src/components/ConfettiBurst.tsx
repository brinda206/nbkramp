import { useEffect, useRef } from 'react';

const COLORS = ['#00C896', '#F0A500', '#6B9FFF', '#E2DDD0', '#FF6B6B'];

interface Particle {
  x: number; y: number;
  vx: number; vy: number;
  color: string;
  size: number;
  life: number;
  rotation: number;
  rotSpeed: number;
}

export function ConfettiBurst({ trigger }: { trigger: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const particles = useRef<Particle[]>([]);
  const raf       = useRef<number>(0);

  useEffect(() => {
    if (!trigger || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const ctx    = canvas.getContext('2d')!;
    const W = canvas.width  = canvas.offsetWidth;
    const H = canvas.height = canvas.offsetHeight;
    const cx = W / 2, cy = H * 0.4;

    // Spawn particles
    particles.current = Array.from({ length: 55 }, () => {
      const angle = (Math.random() * Math.PI * 2);
      const speed = 3 + Math.random() * 5;
      return {
        x:        cx + (Math.random() - 0.5) * 40,
        y:        cy,
        vx:       Math.cos(angle) * speed,
        vy:       Math.sin(angle) * speed - 3,
        color:    COLORS[Math.floor(Math.random() * COLORS.length)],
        size:     4 + Math.random() * 6,
        life:     1,
        rotation: Math.random() * Math.PI * 2,
        rotSpeed: (Math.random() - 0.5) * 0.3,
      };
    });

    const tick = () => {
      ctx.clearRect(0, 0, W, H);
      let alive = false;
      for (const p of particles.current) {
        if (p.life <= 0) continue;
        alive = true;
        p.x  += p.vx;
        p.y  += p.vy;
        p.vy += 0.18;   // gravity
        p.vx *= 0.99;
        p.rotation += p.rotSpeed;
        p.life -= 0.018;

        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rotation);
        ctx.globalAlpha = Math.max(0, p.life);
        ctx.fillStyle   = p.color;
        ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
        ctx.restore();
      }
      if (alive) raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [trigger]);

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: 'absolute', inset: 0,
        width: '100%', height: '100%',
        pointerEvents: 'none',
        borderRadius: 'inherit',
      }}
    />
  );
}
