import { initMotion, initHeader, stretchIn, gsap } from './motion.js';

// Frames of a real camera orbit around the solved room, for the scroll-scrubbed section.
const scrubFrames = Object.entries(import.meta.glob('./media/seq/air/*.webp', { eager: true, query: '?url', import: 'default' }))
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([, url]) => url);

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// Before/after swipe between two solved layouts.
function initSwipe(root) {
  const handle = root.querySelector('.swipe-handle');
  let position = 50;
  let introFrame = 0;

  const set = (value) => {
    position = Math.min(100, Math.max(0, value));
    root.style.setProperty('--pos', `${position}%`);
    root.dataset.near = position > 70 ? 'a' : position < 30 ? 'b' : '';
    handle.setAttribute('aria-valuenow', String(Math.round(position)));
    handle.setAttribute('aria-valuetext', position >= 99 ? 'Layout A only' : position <= 1 ? 'Layout B only' : `${Math.round(position)}% layout A, ${Math.round(100 - position)}% layout B`);
  };
  const stopIntro = () => cancelAnimationFrame(introFrame);
  const fromPointer = (event) => {
    const bounds = root.getBoundingClientRect();
    set(((event.clientX - bounds.left) / bounds.width) * 100);
  };

  // Native image dragging would otherwise hijack the gesture and cancel the pointer.
  root.addEventListener('dragstart', (event) => event.preventDefault());
  root.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    // On touch screens only the handle drags, so the image can still be scrolled past.
    if (event.pointerType === 'touch' && !event.target.closest('.swipe-handle')) return;
    stopIntro();
    root.classList.add('is-dragging');
    root.setPointerCapture(event.pointerId);
    fromPointer(event);
    handle.focus({ preventScroll: true });
  });
  root.addEventListener('pointermove', (event) => {
    if (root.classList.contains('is-dragging')) fromPointer(event);
  });
  const endDrag = () => root.classList.remove('is-dragging');
  root.addEventListener('pointerup', endDrag);
  root.addEventListener('pointercancel', endDrag);

  handle.addEventListener('keydown', (event) => {
    const step = event.shiftKey ? 10 : 2;
    const moves = { ArrowLeft: -step, ArrowDown: -step, ArrowRight: step, ArrowUp: step };
    if (event.key in moves) set(position + moves[event.key]);
    else if (event.key === 'Home') set(0);
    else if (event.key === 'End') set(100);
    else return;
    stopIntro();
    event.preventDefault();
  });

  // One orchestrated moment: reveal layout A, then settle on the split.
  if (reducedMotion) return set(50);
  set(100);
  const keyframes = [[0, 100], [700, 100], [1500, 12], [2300, 12], [3000, 50]];
  const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
  let start = 0;
  const tick = (now) => {
    start ||= now;
    const elapsed = now - start;
    const index = keyframes.findIndex(([time]) => time > elapsed);
    if (index === -1) return set(50);
    const [t0, v0] = keyframes[index - 1];
    const [t1, v1] = keyframes[index];
    set(v0 + (v1 - v0) * ease((elapsed - t0) / (t1 - t0)));
    introFrame = requestAnimationFrame(tick);
  };
  const begin = () => { setTimeout(() => { introFrame = requestAnimationFrame(tick); }, 900); };
  const images = [...root.querySelectorAll('img')];
  Promise.all(images.map((image) => image.decode().catch(() => {}))).then(begin);
}

// Sticky lens showcase: the step in the middle of the screen picks the image.
function initShowcase(root) {
  const steps = [...root.querySelectorAll('[data-lens-step]')];
  const images = [...root.querySelectorAll('[data-lens-image]')];
  const stage = root.querySelector('.showcase-stage');
  const activate = (lens) => {
    for (const step of steps) step.classList.toggle('is-active', step.dataset.lensStep === lens);
    for (const image of images) image.classList.toggle('is-active', image.dataset.lensImage === lens);
    const color = getComputedStyle(steps.find((step) => step.dataset.lensStep === lens)).getPropertyValue('--c');
    stage.style.setProperty('--stage-glow', color);
  };
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) if (entry.isIntersecting) activate(entry.target.dataset.lensStep);
  }, { rootMargin: '-45% 0px -45% 0px' });
  steps.forEach((step) => observer.observe(step));
}

function initScrub(root) {
  const canvas = root.querySelector('.scrub-canvas');
  const context = canvas.getContext('2d');
  const beats = [...root.querySelectorAll('.scrub-beat')];
  const bar = root.querySelector('.scrub-progress span');
  if (reducedMotion || !scrubFrames.length) {
    root.classList.add('is-static');
    return;
  }
  root.classList.add('is-live');
  const frames = scrubFrames.map((src) => {
    const image = new Image();
    image.decoding = 'async';
    image.src = src;
    return image;
  });
  let current = -1;
  const draw = (index) => {
    const frame = frames[index];
    if (index === current || !frame.complete || !frame.naturalWidth) return;
    current = index;
    context.drawImage(frame, 0, 0, canvas.width, canvas.height);
  };
  frames[0].addEventListener('load', () => draw(0), { once: true });

  const state = { frame: 0 };
  const timeline = gsap.timeline({
    scrollTrigger: { trigger: root, start: 'top top', end: '+=260%', pin: root.querySelector('.scrub-stage'), scrub: 0.6, anticipatePin: 1 },
  });
  timeline.to(state, { frame: frames.length - 1, ease: 'none', duration: beats.length, onUpdate: () => draw(Math.round(state.frame)) }, 0);
  timeline.to(bar, { scaleX: 1, ease: 'none', duration: beats.length }, 0);
  beats.forEach((beat, index) => {
    if (index > 0) timeline.fromTo(beat, { opacity: 0, y: 40 }, { opacity: 1, y: 0, duration: 0.35 }, index - 0.1);
    if (index < beats.length - 1) timeline.to(beat, { opacity: 0, y: -40, duration: 0.3 }, index + 0.75);
  });
}

// Cards light up under the cursor.
function initGlow(card) {
  card.addEventListener('pointermove', (event) => {
    const bounds = card.getBoundingClientRect();
    card.style.setProperty('--mx', `${event.clientX - bounds.left}px`);
    card.style.setProperty('--my', `${event.clientY - bounds.top}px`);
  });
}

// The score ring fills when it scrolls into view.
function initScore(root) {
  new IntersectionObserver(([entry], observer) => {
    if (!entry.isIntersecting) return;
    root.classList.add('is-in');
    observer.disconnect();
  }, { threshold: 0.4 }).observe(root);
}

document.querySelectorAll('[data-swipe]').forEach(initSwipe);
document.querySelectorAll('[data-showcase]').forEach(initShowcase);
document.querySelectorAll('[data-scrub]').forEach(initScrub);
document.querySelectorAll('[data-glow]').forEach(initGlow);
document.querySelectorAll('.score-big').forEach(initScore);
document.querySelector('[data-nav-toggle]')?.addEventListener('click', () => document.querySelector('.site-nav').classList.toggle('is-open'));
initHeader();
stretchIn(document.querySelector('[data-stretch]'), { delay: 0.15 });
initMotion();
