import React, { useEffect, useRef, useImperativeHandle, forwardRef } from 'react';

/**
 * FighterCanvas — 60fps procedural fighter canvas (PRD §14, §30).
 *
 * Skeletal stickman animation, hitsparks, slash trails and camera shake,
 * adhering to the Side-Color Rule (PRD §14.2): seat 0 is `--brand`, seat 1 is
 * `--accent`. Both are read from the computed CSS variables at mount, so the
 * fighters follow the theme. (This comment previously named "Brand Indigo
 * #6366f1" and "Accent Rose #f43f5e" — neither is a token this app has ever
 * shipped; the real values are forge orange and steel blue, and the accent one
 * differs between light and dark.)
 *
 * Two silhouettes, chosen per seat via the `silhouettes` prop:
 *   `stick`  — open skeleton, the original.
 *   `ninja`  — filled hood, wrapped torso and a trailing scarf, for the Shadow
 *              Ninja avatar. Same skeleton and same poses underneath, so a pose
 *              added for one is available to the other.
 */

// Theme tokens, refreshed at mount. Fallbacks only matter for the first frame
// before `getComputedStyle` resolves.
let p0Rgb = '255, 122, 47';
let p1Rgb = '79, 195, 247';
let lineRgb = '255, 255, 255';
let infoRgb = '90, 169, 255';
let goodRgb = '74, 222, 128';

export const FighterCanvas = forwardRef(function FighterCanvas(
  {
    width = 800,
    height = 360,
    className = '',
    silhouettes = ['stick', 'stick'],
  },
  ref
) {
  const canvasRef = useRef(null);

  /**
   * Silhouettes ride in a ref, not the effect's dependency array.
   *
   * The caller passes a fresh array literal (`[avatarDef.silhouette, 'stick']`)
   * on every render, so listing it as a dependency would tear down and restart
   * the requestAnimationFrame loop on every parent render — a stutter on the
   * typing hot path. Reading it through a ref keeps the loop alive while still
   * picking up a changed avatar on the next frame.
   */
  const silRef = useRef(silhouettes);
  silRef.current = silhouettes;

  // Mutable animation state (decoupled from React re-renders)
  const stateRef = useRef({
    p0: {
      action: 'idle',
      actionTimer: 0,
      actionDuration: 0,
      hp: 1000,
      focus: 0,
    },
    p1: {
      action: 'idle',
      actionTimer: 0,
      actionDuration: 0,
      hp: 1000,
      focus: 0,
    },
    particles: [],
    projectiles: [],
    shakeAmount: 0,
    lastTime: performance.now(),
  });

  useImperativeHandle(ref, () => ({
    triggerAction: (seat, action, durationMs = 400) => {
      const fighter = seat === 0 ? stateRef.current.p0 : stateRef.current.p1;
      fighter.action = action;
      fighter.actionTimer = 0;
      fighter.actionDuration = durationMs;

      // Camera shake and hit sparks on heavy impacts (disabled when reduced motion is preferred)
      const prefersReducedMotion = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
      if (!prefersReducedMotion) {
        if (['crush', 'overdrive'].includes(action)) {
          stateRef.current.shakeAmount = 8;
        } else if (['slash', 'parry'].includes(action)) {
          stateRef.current.shakeAmount = 4;
        }
      }

      // Spawn projectile for shuriken
      if (action === 'shuriken') {
        const startX = seat === 0 ? width * 0.35 : width * 0.65;
        const targetX = seat === 0 ? width * 0.68 : width * 0.32;
        const color = seat === 0 ? `rgb(${p0Rgb})` : `rgb(${p1Rgb})`;
        stateRef.current.projectiles.push({
          x: startX,
          y: height * 0.55,
          targetX,
          speed: (targetX - startX) / (durationMs * 0.6),
          color,
          life: durationMs * 0.6,
        });
      }
    },
    triggerHit: (targetSeat, damage, isParry = false) => {
      const fighter = targetSeat === 0 ? stateRef.current.p0 : stateRef.current.p1;
      fighter.action = isParry ? 'parry' : 'flinch';
      fighter.actionTimer = 0;
      fighter.actionDuration = isParry ? 300 : 250;

      // Spawn hit particles
      const hitX = targetSeat === 0 ? width * 0.35 : width * 0.65;
      const hitY = height * 0.55;
      const particleColor = isParry ? `rgb(${infoRgb})` : targetSeat === 0 ? `rgb(${p0Rgb})` : `rgb(${p1Rgb})`;

      for (let i = 0; i < (isParry ? 20 : 12); i++) {
        const angle = Math.random() * Math.PI * 2;
        const speed = 2 + Math.random() * (isParry ? 6 : 4);
        stateRef.current.particles.push({
          x: hitX,
          y: hitY,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed - 1,
          size: 2 + Math.random() * 3,
          color: particleColor,
          alpha: 1,
          life: 300,
          maxLife: 300,
        });
      }
    },
    updateState: (p0Hp, p1Hp, p0Focus, p1Focus) => {
      stateRef.current.p0.hp = p0Hp;
      stateRef.current.p1.hp = p1Hp;
      stateRef.current.p0.focus = p0Focus;
      stateRef.current.p1.focus = p1Focus;
    },
  }));

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    let animId;
    
    // Fetch theme tokens once per mount/resize
    const rootStyle = getComputedStyle(document.documentElement);
    p0Rgb = rootStyle.getPropertyValue('--brand').trim() || p0Rgb;
    p1Rgb = rootStyle.getPropertyValue('--accent').trim() || p1Rgb;
    lineRgb = rootStyle.getPropertyValue('--line-strong').trim() || lineRgb;
    infoRgb = rootStyle.getPropertyValue('--info').trim() || infoRgb;
    goodRgb = rootStyle.getPropertyValue('--good').trim() || goodRgb;

    const render = (time) => {
      const dt = Math.min(time - stateRef.current.lastTime, 100);
      stateRef.current.lastTime = time;

      // Camera shake decay
      let shakeX = 0;
      let shakeY = 0;
      if (stateRef.current.shakeAmount > 0.1) {
        shakeX = (Math.random() - 0.5) * stateRef.current.shakeAmount;
        shakeY = (Math.random() - 0.5) * stateRef.current.shakeAmount;
        stateRef.current.shakeAmount *= 0.88;
      } else {
        stateRef.current.shakeAmount = 0;
      }

      ctx.clearRect(0, 0, width, height);
      ctx.save();
      ctx.translate(shakeX, shakeY);

      // Draw ground line
      const groundY = height * 0.78;
      ctx.strokeStyle = `rgba(${lineRgb}, 0.2)`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(width * 0.1, groundY);
      ctx.lineTo(width * 0.9, groundY);
      ctx.stroke();

      // Center arena boundary indicator
      ctx.strokeStyle = `rgba(${lineRgb}, 0.08)`;
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(width * 0.5, groundY - 80);
      ctx.lineTo(width * 0.5, groundY);
      ctx.stroke();
      ctx.setLineDash([]);

      // Update & Draw P0 (Left, Facing Right)
      updateFighter(stateRef.current.p0, dt);
      drawFighter(
        ctx,
        width * 0.32,
        groundY,
        stateRef.current.p0,
        1, // facing right
        `rgb(${p0Rgb})`,
        `rgba(${p0Rgb}, 0.4)`,
        time,
        silRef.current[0] ?? 'stick'
      );

      // Update & Draw P1 (Right, Facing Left)
      updateFighter(stateRef.current.p1, dt);
      drawFighter(
        ctx,
        width * 0.68,
        groundY,
        stateRef.current.p1,
        -1, // facing left
        `rgb(${p1Rgb})`,
        `rgba(${p1Rgb}, 0.4)`,
        time,
        silRef.current[1] ?? 'stick'
      );

      // Update & Draw Projectiles
      stateRef.current.projectiles = stateRef.current.projectiles.filter((p) => {
        p.x += p.speed * dt;
        p.life -= dt;
        ctx.fillStyle = p.color;
        ctx.shadowColor = p.color;
        ctx.shadowBlur = 8;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
        return p.life > 0;
      });

      // Update & Draw Particles
      stateRef.current.particles = stateRef.current.particles.filter((pt) => {
        pt.x += pt.vx;
        pt.y += pt.vy;
        pt.vy += 0.15; // Gravity
        pt.life -= dt;
        const progress = Math.max(0, pt.life / pt.maxLife);

        ctx.fillStyle = pt.color;
        ctx.globalAlpha = progress;
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, pt.size * progress, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
        return pt.life > 0;
      });

      ctx.restore();
      animId = requestAnimationFrame(render);
    };

    animId = requestAnimationFrame(render);
    return () => cancelAnimationFrame(animId);
  }, [width, height]);

  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={height}
      className={`block w-full max-w-full select-none ${className}`}
    />
  );
});

function updateFighter(fighter, dt) {
  if (fighter.action !== 'idle') {
    fighter.actionTimer += dt;
    if (fighter.actionTimer >= fighter.actionDuration) {
      fighter.action = 'idle';
      fighter.actionTimer = 0;
    }
  }
}

/**
 * Procedural fighter renderer.
 *
 * One skeleton, two skins. `silhouette === 'ninja'` thickens the strokes, fills
 * the head as a hood, wraps the torso and trails a scarf; the joint solve above
 * is identical, so every pose works for both and a new pose never has to be
 * authored twice.
 */
function drawFighter(ctx, x, groundY, fighter, dir, color, glowColor, time, silhouette = 'stick') {
  const { action, actionTimer, actionDuration, focus } = fighter;
  const progress = actionDuration > 0 ? actionTimer / actionDuration : 0;
  const isNinja = silhouette === 'ninja';

  ctx.save();
  ctx.translate(x, groundY);
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = isNinja ? 5 : 3.5;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // Glow when Overdrive ready (Focus === 100)
  if (focus >= 100) {
    ctx.shadowColor = glowColor;
    ctx.shadowBlur = 16;
  }

  // Idle breath oscillation
  const breath = Math.sin(time * 0.005) * 3;
  let headY = -90 + breath;
  let pelvisX = 0;
  let pelvisY = -45 + breath * 0.5;

  let leftHandX = -12 * dir;
  let leftHandY = -50;
  let rightHandX = 14 * dir;
  let rightHandY = -55;

  let leftFootX = -14 * dir;
  let leftFootY = 0;
  let rightFootX = 14 * dir;
  let rightFootY = 0;

  // Apply action-specific pose interpolation
  if (action === 'jab') {
    const t = Math.sin(progress * Math.PI);
    pelvisX += 20 * dir * t;
    rightHandX += 45 * dir * t;
    rightHandY -= 10 * t;
  } else if (action === 'slash') {
    const t = Math.sin(progress * Math.PI);
    pelvisX += 15 * dir * t;
    rightHandX += 40 * dir * t;
    rightHandY += (progress < 0.5 ? -35 : 20) * t;

    // Draw slash trail arc
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.arc(pelvisX + 25 * dir, pelvisY - 10, 35, -Math.PI * 0.4, Math.PI * 0.4, dir < 0);
    ctx.stroke();
    ctx.restore();
  } else if (action === 'crush') {
    const jump = Math.sin(progress * Math.PI) * 45;
    pelvisY -= jump;
    headY -= jump;
    rightHandX += 10 * dir;
    rightHandY -= (jump > 15 ? 40 : -10);
  } else if (action === 'guard') {
    pelvisX -= 8 * dir;
    leftHandX = 18 * dir;
    leftHandY = -65;
    rightHandX = 12 * dir;
    rightHandY = -45;

    // Energy guard arc
    ctx.save();
    ctx.strokeStyle = `rgb(${infoRgb})`;
    ctx.lineWidth = 3;
    ctx.shadowColor = `rgb(${infoRgb})`;
    ctx.shadowBlur = 10;
    ctx.beginPath();
    ctx.arc(20 * dir, pelvisY, 30, -Math.PI * 0.35, Math.PI * 0.35, dir < 0);
    ctx.stroke();
    ctx.restore();
  } else if (action === 'parry') {
    const t = Math.sin(progress * Math.PI);
    leftHandX = 24 * dir * t;
    leftHandY = -70;
    rightHandX = 28 * dir * t;
    rightHandY = -55;

    // Parry deflection ring
    ctx.save();
    ctx.strokeStyle = `rgb(${infoRgb})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(26 * dir, -60, 20 * progress + 5, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  } else if (action === 'evade' || action === 'jump') {
    /**
     * The Jump lane. A backward hop with the legs tucked — it has to read as
     * "not there any more" rather than as an attack, so the whole body leaves
     * the ground and drifts *away* from the opponent, the opposite of Crush's
     * forward leap.
     */
    const hop = Math.sin(progress * Math.PI);
    pelvisY -= hop * 52;
    headY -= hop * 52;
    pelvisX -= hop * 22 * dir;
    leftFootX = -6 * dir;
    leftFootY = -hop * 26;
    rightFootX = 8 * dir;
    rightFootY = -hop * 34;
    leftHandX = -20 * dir;
    leftHandY = -60 - hop * 8;
    rightHandX = -6 * dir;
    rightHandY = -66 - hop * 10;

    // Dust puff at the take-off point, fading as the hop peaks.
    ctx.save();
    ctx.globalAlpha = Math.max(0, 0.5 - hop * 0.5);
    ctx.fillStyle = `rgba(${lineRgb}, 0.5)`;
    for (const off of [-14, 0, 14]) {
      ctx.beginPath();
      ctx.arc(off * dir + 10 * dir, -3, 4 + hop * 6, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  } else if (action === 'mend') {
    headY += 10;
    pelvisY += 8;
    leftHandY = -40;
    rightHandY = -40;

    // Rising healing sparks
    ctx.fillStyle = `rgb(${goodRgb})`;
    ctx.beginPath();
    ctx.arc(Math.sin(time * 0.02) * 15, -40 - (actionTimer % 30), 2.5, 0, Math.PI * 2);
    ctx.fill();
  } else if (action === 'overdrive') {
    const flurry = Math.sin(time * 0.04) * 20;
    rightHandX += (35 + flurry) * dir;
    leftHandX += (25 - flurry) * dir;
  } else if (action === 'flinch') {
    const t = Math.sin(progress * Math.PI);
    pelvisX -= 18 * dir * t;
    headY += 8 * t;
    leftHandX -= 10 * dir;
    rightHandX -= 15 * dir;
  }

  /* ── Skin ──────────────────────────────────────────────────────────────
     The joint solve above is complete and identical for both silhouettes.
     Everything below is presentation only, so a pose authored once works for
     both fighters. */

  if (isNinja) {
    // Scarf first, so it sits behind the body. Trails opposite the facing
    // direction and lags the torso, which is what sells the movement.
    const sway = Math.sin(time * 0.006) * 6;
    ctx.save();
    ctx.globalAlpha = 0.75;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(pelvisX, headY + 14);
    ctx.quadraticCurveTo(
      pelvisX - 22 * dir, headY + 20 + sway,
      pelvisX - 40 * dir, headY + 34 + sway * 1.6,
    );
    ctx.stroke();
    ctx.restore();

    // Hood: a filled cowl rather than a bare circle, with a notch cut for the
    // face so the fighter has a facing direction you can read at a glance.
    ctx.beginPath();
    ctx.arc(pelvisX, headY, 12.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.save();
    ctx.globalAlpha = 0.85;
    ctx.fillStyle = `rgba(${lineRgb}, 0.55)`;
    ctx.beginPath();
    ctx.ellipse(pelvisX + 6 * dir, headY - 1, 4.5, 2.4, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Wrapped torso — a tapered body instead of a single line.
    ctx.beginPath();
    ctx.lineWidth = 9;
    ctx.moveTo(pelvisX, headY + 12);
    ctx.lineTo(pelvisX, pelvisY);
    ctx.stroke();
    ctx.lineWidth = 5;
  } else {
    // Draw Head
    ctx.beginPath();
    ctx.arc(pelvisX, headY, 11, 0, Math.PI * 2);
    ctx.fill();

    // Draw Torso
    ctx.beginPath();
    ctx.moveTo(pelvisX, headY + 11);
    ctx.lineTo(pelvisX, pelvisY);
    ctx.stroke();
  }

  // Draw Left Arm
  ctx.beginPath();
  ctx.moveTo(pelvisX, headY + 22);
  ctx.lineTo(leftHandX, leftHandY);
  ctx.stroke();

  // Draw Right Arm
  ctx.beginPath();
  ctx.moveTo(pelvisX, headY + 22);
  ctx.lineTo(rightHandX, rightHandY);
  ctx.stroke();

  // Draw Left Leg
  ctx.beginPath();
  ctx.moveTo(pelvisX, pelvisY);
  ctx.lineTo((pelvisX + leftFootX) / 2 - 4 * dir, (pelvisY + leftFootY) / 2);
  ctx.lineTo(leftFootX, leftFootY);
  ctx.stroke();

  // Draw Right Leg
  ctx.beginPath();
  ctx.moveTo(pelvisX, pelvisY);
  ctx.lineTo((pelvisX + rightFootX) / 2 + 4 * dir, (pelvisY + rightFootY) / 2);
  ctx.lineTo(rightFootX, rightFootY);
  ctx.stroke();

  ctx.restore();
}
