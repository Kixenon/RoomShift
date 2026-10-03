import { initMotion, initHeader, stretchIn, gsap, ScrollTrigger } from './motion.js';

// Bundled URLs for every layout render, so swapped sources survive hashing in the build.
const layoutImages = import.meta.glob('./img/layout-*.webp', { eager: true, query: '?url', import: 'default' });

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

// Room / Air / Heat / Light tabs.
function initLayerTabs(root) {
  const tabs = [...root.querySelectorAll('[role="tab"]')];
  const panel = root.querySelector('[role="tabpanel"]');
  const select = (tab, focus = false) => {
    const layer = tab.dataset.layer;
    for (const other of tabs) {
      const active = other === tab;
      other.setAttribute('aria-selected', String(active));
      other.tabIndex = active ? 0 : -1;
    }
    panel.setAttribute('aria-labelledby', tab.id);
    for (const media of root.querySelectorAll('[data-layer-image]')) {
      const active = media.dataset.layerImage === layer;
      media.classList.toggle('is-active', active);
      if (media.tagName !== 'VIDEO') continue;
      if (active && !reducedMotion) {
        media.preload = 'auto';
        media.play().catch(() => {});
      } else media.pause();
    }
    for (const note of root.querySelectorAll('[data-layer-note]')) note.hidden = note.dataset.layerNote !== layer;
    if (focus) tab.focus();
  };
  tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => select(tab));
    tab.addEventListener('keydown', (event) => {
      const offset = { ArrowRight: 1, ArrowLeft: -1 }[event.key];
      if (event.key === 'Home') select(tabs[0], true);
      else if (event.key === 'End') select(tabs.at(-1), true);
      else if (offset) select(tabs[(index + offset + tabs.length) % tabs.length], true);
      else return;
      event.preventDefault();
    });
  });
}

// Layout A / B plans, switched together.
function initCompare(root) {
  const buttons = [...root.querySelectorAll('[data-compare]')];
  const images = { a: root.querySelector('[data-compare-image="a"]'), b: root.querySelector('[data-compare-image="b"]') };
  const names = { top: 'seen from above', 'top-air': 'airflow from above', 'top-heat': 'heat from above', light: 'light and shadow preview' };
  // Each solve has its own scale; these are the editor's legend values for these renders.
  const captions = {
    top: { a: 'The default room', b: 'Four pieces moved' },
    'top-air': { a: 'Airflow, 0 to 2.26 m/s', b: 'Airflow, 0 to 2.30 m/s' },
    'top-heat': { a: 'Heat, 20.0 to 32.1 °C', b: 'Heat, 20.0 to 33.2 °C' },
    light: { a: 'Shadow preview', b: 'Shadow preview' },
  };
  const choose = (button) => {
    const view = button.dataset.compare;
    for (const other of buttons) other.setAttribute('aria-pressed', String(other === button));
    for (const [key, image] of Object.entries(images)) {
      const next = layoutImages[`./img/layout-${key}-${view}.webp`];
      if (image.dataset.view === view) continue;
      image.dataset.view = view;
      image.classList.add('is-loading');
      const loader = new Image();
      loader.src = next;
      loader.decode().catch(() => {}).then(() => {
        image.src = next;
        image.alt = `Layout ${key.toUpperCase()}, ${names[view]}.`;
        image.classList.remove('is-loading');
      });
    }
    for (const caption of root.querySelectorAll('[data-compare-caption]')) caption.textContent = captions[view][caption.dataset.compareCaption];
    for (const note of root.querySelectorAll('[data-tradeoff]')) note.classList.toggle('is-current', note.dataset.tradeoff === view);
  };
  buttons.forEach((button) => button.addEventListener('click', () => choose(button)));
}

// The live editor loads only on request: it starts a GPU solver.
function initEmbed(root) {
  root.querySelector('[data-embed-load]').addEventListener('click', () => {
    const frame = document.createElement('iframe');
    frame.src = '../';
    frame.title = 'RoomShift editor';
    frame.allow = 'fullscreen';
    root.append(frame);
    root.classList.add('is-live');
    frame.focus();
  });
}

// Pinned section: scrolling scrubs through a real orbit of the solved room.
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

// Play the active layer clip only while it's on screen.
function initLayerVideos(root) {
  ScrollTrigger.create({
    trigger: root,
    start: 'top bottom',
    end: 'bottom top',
    onToggle: ({ isActive }) => {
      const video = root.querySelector('video.is-active');
      if (!video || reducedMotion) return;
      if (isActive) video.play().catch(() => {});
      else video.pause();
    },
  });
}

document.querySelectorAll('[data-swipe]').forEach(initSwipe);
document.querySelectorAll('[data-tabs]').forEach(initLayerTabs);
document.querySelectorAll('.compare').forEach(initCompare);
document.querySelectorAll('[data-embed]').forEach(initEmbed);
document.querySelectorAll('[data-scrub]').forEach(initScrub);
document.querySelectorAll('.layer-viewer').forEach(initLayerVideos);
initHeader();
stretchIn(document.querySelector('[data-stretch]'), { delay: 0.15 });
initMotion();
