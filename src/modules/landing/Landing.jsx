import { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, ArrowUpRight } from 'lucide-react';
import Logo from '../../components/brand/Logo.jsx';
import './landing-hero.css';

/**
 * The public front door — a cinematic product introduction, not a page of
 * chrome.
 *
 * The first viewport carries exactly five things: the footage, the lockup,
 * the headline, the supporting line and two CTAs. No navbar, no links, no
 * footer up there — a stranger should read "typing + coding + competition"
 * off one screen in three seconds, and every extra element competes with
 * that read.
 *
 * Layer stack, back to front (z-orders live in landing-hero.css):
 *
 *   video → readability veils → drifting dot texture → particle field
 *         → grain → cursor light → content plane
 *
 * Motion inventory, each with a reason to exist:
 *
 *   - Entrance choreography (CSS, staggered via --d) typesets the first view.
 *   - A particle field of violet/cyan motes drifts upward through the scene —
 *     atmosphere, drawn on one canvas with no per-particle DOM.
 *   - A dot-grid texture slides one tile-period on a 46-second loop, which
 *     reads as depth without ever drawing attention to itself.
 *   - Scrolling parallax-fades the content plane and kills the scroll cue
 *     early, so leaving the hero feels like the camera moving on, not the
 *     page breaking.
 *   - Below the fold, the mode index reveals row-by-row on first sight.
 *
 * Everything honours prefers-reduced-motion: entrances land instantly, the
 * particles never start, the texture stands still, the footage shows its
 * poster instead of playing, and the scroll parallax is skipped entirely.
 */

export default function Landing() {
  const stageRef = useRef(null);
  const glowRef = useRef(null);

  return (
    <main className="tf-hero min-h-dvh">
      <Hero stageRef={stageRef} glowRef={glowRef} />
      <ModesIndex />
      <Foot />
    </main>
  );
}

/* ── First viewport ────────────────────────────────────────────────────── */

function Hero({ stageRef, glowRef }) {
  const videoRef = useRef(null);
  const planeRef = useRef(null);
  const cueRef = useRef(null);

  useVideoAutoplay(videoRef);
  useCursorLight(stageRef, glowRef);
  useHeroScroll(planeRef, cueRef);

  return (
    <section ref={stageRef} className="relative h-dvh min-h-[620px] overflow-hidden">
      <video
        ref={videoRef}
        className="tf-hero-video"
        autoPlay
        muted
        loop
        playsInline
        preload="auto"
        poster="/vid/typeforge-poster.jpg"
        disablePictureInPicture
        aria-hidden="true"
        tabIndex={-1}
      >
        <source src="/vid/typeforge.mp4" type="video/mp4" />
      </video>

      {/* Readability veils + living texture. Purely presentational layers. */}
      <div className="tf-veil-left" aria-hidden />
      <div className="tf-veil-top" aria-hidden />
      <div className="tf-veil-bottom" aria-hidden />
      <div className="tf-vignette" aria-hidden />
      <div className="tf-texture" aria-hidden />
      <Particles stageRef={stageRef} />
      <div className="tf-grain" aria-hidden />
      <div ref={glowRef} className="tf-glow" aria-hidden />

      {/* Content plane. The scroll parallax writes transform/opacity here —
          never on the children, whose entrance animations own those exact
          properties on themselves. */}
      <div
        ref={planeRef}
        className="relative z-10 flex h-full flex-col px-5 pb-28 pt-6 sm:px-10 sm:pt-8 lg:px-16"
      >
        <header className="tf-rise" style={{ '--d': '60ms' }}>
          <Link to="/" className="inline-flex items-center gap-2.5 rounded-sm">
            <Logo size={30} />
            <span className="font-display text-xl font-bold tracking-[-0.03em] text-white">
              TypeForge
            </span>
          </Link>
          <p className="tf-tagline mt-2">Type faster. Code sharper. Battle harder.</p>
        </header>

        <div className="my-auto w-full max-w-[900px] pt-14">
          <p className="tf-eyebrow tf-rise" style={{ '--d': '150ms' }}>
            <span className="tf-eyebrow-tick" aria-hidden />
            The next generation of typing
          </p>

          {/**
           * The headline is four masked words, not two lines of text: each
           * word rises into its own overflow-hidden strip on a staggered
           * delay, so the entrance reads as typeset rather than slid in.
           */}
          <h1
            className="mt-5 font-display font-bold uppercase text-white"
            style={{ fontSize: 'clamp(38px, 6.6vw, 88px)', lineHeight: 1.04, letterSpacing: '-0.03em' }}
          >
            <span className="tf-line">
              <span className="tf-word" style={{ '--d': '230ms' }}>Type</span>{' '}
              <span className="tf-word" style={{ '--d': '310ms' }}>faster.</span>
            </span>
            <span className="tf-line">
              <span className="tf-word tf-grad" style={{ '--d': '390ms' }}>Play</span>{' '}
              <span className="tf-word tf-grad" style={{ '--d': '470ms' }}>harder.</span>
            </span>
          </h1>

          <p className="tf-support tf-rise" style={{ '--d': '580ms' }}>
            Master your keyboard. Sharpen your code.
            <br />
            Challenge your limits.
          </p>

          <div
            className="tf-rise mt-8 flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4"
            style={{ '--d': '700ms' }}
          >
            {/** Primary goes to real practice — the product, not an
                intermediate pitch page. Secondary opens the competitive
                fork, where battle and shadow battle both live. */}
            <Link to="/practice" className="tf-btn tf-btn-primary">
              Start Typing
              <ArrowRight size={17} strokeWidth={2.4} className="tf-arrow" aria-hidden />
            </Link>
            <Link to="/arena" className="tf-btn tf-btn-ghost">
              Enter the Arena
            </Link>
          </div>
        </div>
      </div>

      {/** The wrapper exists because .tf-rise's forwards fill owns opacity on
          the anchor — scroll fading needs a parent whose opacity is free.
          The wrapper positions; the anchor rises once and then just glows. */}
      <div
        ref={cueRef}
        className="pointer-events-none absolute inset-x-0 bottom-4 z-10 flex justify-center"
      >
        <a href="#modes" className="tf-scrollcue tf-rise pointer-events-auto" style={{ '--d': '980ms' }}>
          <span className="sr-only">Scroll to explore</span>
          <span className="tf-scrollcue-track" aria-hidden>
            <span className="tf-scrollcue-dot" aria-hidden />
          </span>
          <span className="tf-scrollcue-label" aria-hidden>
            Scroll to explore
          </span>
        </a>
      </div>
    </section>
  );
}

/* ── Motion ────────────────────────────────────────────────────────────── */

/**
 * Keeps the muted-autoplay promise (retry on visibility if a webview refused
 * it once) and withholds playback entirely from reduced-motion users: they
 * get the poster — a still of the same keyboard — instead of motion.
 */
function useVideoAutoplay(videoRef) {
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return undefined;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return undefined;
    const attempt = () => video.play().catch(() => {});
    attempt();
    document.addEventListener('visibilitychange', attempt);
    return () => document.removeEventListener('visibilitychange', attempt);
  }, []);
}

/**
 * Scroll-linked exit: as the visitor leaves the hero, the content plane
 * drifts up slightly slower than the page and dissolves, and the scroll cue
 * disappears within the first 130px where it has already done its job.
 * One rAF-batched write pair per scroll burst, passive listener, and none of
 * it runs at all under reduced motion.
 */
function useHeroScroll(planeRef, cueRef) {
  useEffect(() => {
    const plane = planeRef.current;
    const cue = cueRef.current;
    if (!plane) return undefined;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return undefined;

    let frame = 0;
    const paint = () => {
      frame = 0;
      const y = window.scrollY;
      const fade = Math.max(0, 1 - y / 480);
      plane.style.transform = `translate3d(0, ${(y * -0.07).toFixed(1)}px, 0)`;
      plane.style.opacity = (0.35 + 0.65 * fade).toFixed(3);
      if (cue) cue.style.opacity = Math.max(0, 1 - y / 130).toFixed(3);
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(paint);
    };

    window.addEventListener('scroll', onScroll, { passive: true });
    paint();
    return () => {
      window.removeEventListener('scroll', onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [planeRef, cueRef]);
}

/**
 * A violet/cyan pool that trails the pointer over the stage.
 *
 * Written straight to `transform`/`opacity` from one rAF callback — never a
 * React state, which would re-render the whole hero on every mousemove. Opts
 * itself out for coarse pointers and reduced-motion users, in which cases
 * the .tf-glow layer simply stays dark.
 */
function useCursorLight(stageRef, glowRef) {
  useEffect(() => {
    const stage = stageRef.current;
    const glow = glowRef.current;
    if (!stage || !glow) return undefined;
    if (!window.matchMedia('(pointer: fine)').matches) return undefined;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return undefined;

    let frame = 0;
    let x = 0;
    let y = 0;

    const paint = () => {
      frame = 0;
      glow.style.transform = `translate3d(${x}px, ${y}px, 0)`;
    };

    const onMove = (event) => {
      const rect = stage.getBoundingClientRect();
      x = event.clientX - rect.left;
      y = event.clientY - rect.top;
      glow.style.opacity = '1';
      if (!frame) frame = requestAnimationFrame(paint);
    };

    const onLeave = () => {
      if (frame) {
        cancelAnimationFrame(frame);
        frame = 0;
      }
      glow.style.opacity = '0';
    };

    stage.addEventListener('pointermove', onMove, { passive: true });
    stage.addEventListener('pointerleave', onLeave);
    return () => {
      stage.removeEventListener('pointermove', onMove);
      stage.removeEventListener('pointerleave', onLeave);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [stageRef, glowRef]);
}

/**
 * Ambient mote field — the footage's edge-light colours as drifting sparks.
 *
 * One canvas, zero per-particle DOM: count scales with area (capped at 90),
 * every mote is a plain arc with additive blending for glow, and the whole
 * simulation is velocity-per-second so a dropped frame never speeds anything
 * up. Drawing skips while the tab is hidden or the stage scrolled away, the
 * canvas resizes with the stage, and reduced-motion users never see it
 * mount at all.
 */
const MOTE_COLORS = [
  [167, 139, 250], // violet
  [103, 232, 249], // cyan
  [242, 244, 247], // off-white, rare
];

function Particles({ stageRef }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const stage = stageRef.current;
    if (!canvas || !stage) return undefined;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return undefined;
    const ctx = canvas.getContext('2d');
    if (!ctx) return undefined;

    let motes = [];
    let frame = 0;
    let visible = true;
    let last = performance.now();

    const spawn = (w, h, anywhere) => ({
      x: Math.random() * w,
      y: anywhere ? Math.random() * h : h + 8,
      r: 0.6 + Math.random() * 1.4,
      vy: 6 + Math.random() * 14,
      drift: 4 + Math.random() * 10,
      phase: Math.random() * Math.PI * 2,
      c: MOTE_COLORS[Math.random() < 0.12 ? 2 : (Math.random() < 0.55 ? 0 : 1)],
    });

    const resize = () => {
      const rect = stage.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.max(1, Math.round(rect.width * dpr));
      canvas.height = Math.max(1, Math.round(rect.height * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const count = Math.min(90, Math.round((rect.width * rect.height) / 22000));
      motes = Array.from({ length: count }, () => spawn(rect.width, rect.height, true));
    };

    const tick = (now) => {
      frame = requestAnimationFrame(tick);
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      if (!visible || document.hidden) return;

      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      ctx.clearRect(0, 0, w, h);
      ctx.globalCompositeOperation = 'lighter';

      for (const m of motes) {
        m.y -= m.vy * dt;
        m.x += Math.sin(m.phase += dt * 1.4) * m.drift * dt;
        if (m.y < -10) Object.assign(m, spawn(w, h, false));
        const alpha = 0.22 + 0.3 * (0.5 + 0.5 * Math.sin(m.phase * 2.6));
        ctx.fillStyle = `rgba(${m.c[0]},${m.c[1]},${m.c[2]},${alpha.toFixed(3)})`;
        ctx.beginPath();
        ctx.arc(m.x, m.y, m.r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalCompositeOperation = 'source-over';
    };

    const io = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
    }, { threshold: 0 });
    io.observe(stage);
    window.addEventListener('resize', resize);

    resize();
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      io.disconnect();
      window.removeEventListener('resize', resize);
    };
  }, [stageRef]);

  return <canvas ref={canvasRef} className="tf-particles" aria-hidden="true" />;
}

/* ── Below the fold ────────────────────────────────────────────────────── */

/**
 * The progressive reveal promised by the scroll cue: what TypeForge is,
 * as six addressable destinations rather than feature cards. An index —
 * numbered rows on hairlines — keeps the launch-page tone while giving
 * every row somewhere real to go.
 */
const MODES = [
  { n: '01', name: 'Typing Practice', route: '/practice', line: 'Six modes, from fifteen-second sprints to zen.' },
  { n: '02', name: 'Code Practice', route: '/code', line: 'Real snippets across eleven languages, symbols included.' },
  { n: '03', name: 'Battle', route: '/battle', line: 'Live races — two to eight players, one passage, one clock.' },
  { n: '04', name: 'Shadow Battle', route: '/shadow', line: 'Asynchronous duels against forged rivals who fight back.' },
  { n: '05', name: 'Leaderboards', route: '/achievements', line: 'Where you stand — verified server-side, not self-reported.' },
  { n: '06', name: 'Progression', route: '/dashboard', line: 'Per-key diagnosis, trends, levels. Your typing, measured.' },
];

function ModesIndex() {
  const sectionRef = useReveal();

  return (
    <section
      id="modes"
      ref={sectionRef}
      className="mx-auto w-full max-w-[1120px] px-5 pb-24 pt-20 sm:px-10 lg:px-16 lg:pt-28"
    >
      <p className="eyebrow tf-index-row" style={{ transitionDelay: '0ms' }}>The forge</p>
      <h2
        className="tf-index-row mt-3 max-w-[22ch] font-display text-3xl font-bold tracking-[-0.02em] text-ink sm:text-4xl"
        style={{ transitionDelay: '70ms' }}
      >
        Six disciplines. One keyboard.
      </h2>
      <p
        className="tf-index-row mt-3 max-w-[52ch] text-base leading-relaxed text-ink-2"
        style={{ transitionDelay: '140ms' }}
      >
        Everything after the first keystroke. Pick a discipline — or let the drill find your weakest
        keys for you.
      </p>

      <ul className="mt-10 border-b border-line">
        {MODES.map((mode, i) => (
          <li key={mode.route} className="tf-index-row" style={{ transitionDelay: `${i * 70}ms` }}>
            <Link
              to={mode.route}
              className="group grid grid-cols-[auto_1fr_auto] items-center gap-4 border-t border-line py-5 transition-colors duration-fast hover:bg-subtle sm:gap-6 sm:py-6"
            >
              <span className="font-mono text-xs tabular-nums text-ink-3">{mode.n}</span>
              <span>
                <span className="block font-display text-xl font-bold tracking-[-0.02em] text-ink transition-colors duration-fast group-hover:text-brand sm:text-2xl">
                  {mode.name}
                </span>
                <span className="mt-1 block max-w-[56ch] text-sm leading-relaxed text-ink-2">
                  {mode.line}
                </span>
              </span>
              <ArrowUpRight
                size={20}
                strokeWidth={2.2}
                aria-hidden
                className="-translate-x-1 translate-y-1 text-ink-3 opacity-0 transition-all duration-base group-hover:translate-x-0 group-hover:translate-y-0 group-hover:text-brand group-hover:opacity-100"
              />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * One-shot scroll reveal for the index. Hand-rolled rather than pulled from
 * framer-motion: this route is the product's front door and carries the
 * tightest bundle budget in the app, and fourteen lines beat a 40 kB chunk
 * dependency for one fade.
 */
function useReveal() {
  const ref = useRef(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    if (!('IntersectionObserver' in window)) {
      el.classList.add('is-in');
      return undefined;
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          el.classList.add('is-in');
          observer.disconnect();
        }
      },
      { rootMargin: '0px 0px -12% 0px', threshold: 0.05 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return ref;
}

/* ── Foot ──────────────────────────────────────────────────────────────── */

/** Deliberately minimal: identity and date. The modes above are the nav. */
function Foot() {
  return (
    <footer className="mx-auto flex w-full max-w-[1120px] flex-col gap-2 border-t border-line px-5 py-6 sm:flex-row sm:items-center sm:justify-between sm:px-10 lg:px-16">
      <span className="flex items-center gap-1.5 text-sm text-ink-3">
        <Logo size={18} />
        <span className="font-display font-bold text-ink-2">TypeForge</span>
      </span>
      <p className="text-xs text-ink-3">Built for people who type for a living. © 2026</p>
    </footer>
  );
}
