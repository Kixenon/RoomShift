import { gsap, SplitText, prefersReducedMotion } from '../motion.js';
import { renderHeatmap, renderJetCheck } from '../charts.js';

const deck = document.querySelector('[data-deck]');
const stage = document.querySelector('[data-stage]');
// ?pitch drops the appendix slides for the timed pitch; the full deck is for the booth and Q&A.
const pitchMode = new URLSearchParams(location.search).has('pitch');
const slides = [...stage.querySelectorAll('.slide')].filter((slide) => {
  if (pitchMode && slide.hasAttribute('data-appendix')) { slide.remove(); return false; }
  return true;
});
const wipe = [...document.querySelectorAll('.wipe span')];
const ui = document.querySelector('[data-ui]');
const progress = document.querySelector('[data-progress]');
const countLabel = document.querySelector('[data-count-label]');
const notesPanel = document.querySelector('[data-notes-panel]');
const notesToggle = document.querySelector('[data-notes-toggle]');
const reduced = prefersReducedMotion();

let index = -1;
let transition = null;
let overview = false;

// ───────── Stage scaling ─────────
const OVERVIEW_COLUMNS = 4;
function fit() {
  if (overview) {
    const width = OVERVIEW_COLUMNS * 1920 + (OVERVIEW_COLUMNS - 1) * 80;
    const scale = (window.innerWidth * 0.92) / width;
    stage.style.transform = `scale(${scale})`;
    stage.style.marginBottom = `${-(1 - scale) * stage.scrollHeight}px`;
    return;
  }
  const scale = Math.min(window.innerWidth / 1920, window.innerHeight / 1080);
  stage.style.transform = `translate(-50%, -50%) scale(${scale})`;
  stage.style.marginBottom = '';
}
window.addEventListener('resize', fit);
fit();

// ───────── Charts, built once ─────────
const noChart = { play: () => {} };
const heatmapHost = stage.querySelector('[data-deck-heatmap]');
const jetHost = stage.querySelector('[data-deck-jet]');
const heatmap = heatmapHost ? renderHeatmap(heatmapHost) : noChart;
const jetChart = jetHost ? renderJetCheck(jetHost) : noChart;
const chartPlayed = new Set();

// ───────── Entrance animations ─────────
const splits = new Map();
function resetSplit(element) {
  splits.get(element)?.revert();
  splits.delete(element);
}

function enter(slide) {
  const timeline = gsap.timeline({ defaults: { ease: 'expo.out', duration: 1 } });
  let at = 0.05;
  for (const element of slide.querySelectorAll('[data-in]')) {
    const kind = element.dataset.in;
    gsap.killTweensOf(element);
    gsap.set(element, { clearProps: 'opacity,transform,visibility' });
    switch (kind) {
      case 'lines': {
        resetSplit(element);
        const split = SplitText.create(element, { type: 'lines', mask: 'lines', linesClass: 'line' });
        splits.set(element, split);
        timeline.from(split.lines, { yPercent: 110, duration: 1.1, stagger: 0.1 }, at);
        at += 0.25;
        break;
      }
      case 'stretch': {
        resetSplit(element);
        const split = SplitText.create(element, { type: 'words,chars', wordsClass: 'word', charsClass: 'char' });
        splits.set(element, split);
        timeline.from(split.chars, { yPercent: 120, '--w': 62, opacity: 0, duration: 1.2, stagger: 0.035 }, at);
        const shift = element.querySelector('.shift');
        if (shift) timeline.fromTo(shift, { x: 140 }, { x: 0, duration: 1.4, ease: 'elastic.out(1, 0.55)' }, at + 0.35);
        at += 0.5;
        break;
      }
      case 'up':
        timeline.from(element, { y: 50, opacity: 0, duration: 0.9 }, at);
        at += 0.12;
        break;
      case 'stagger':
        gsap.set(element.children, { clearProps: 'opacity,transform' });
        timeline.from(element.children, { y: 60, opacity: 0, duration: 0.9, stagger: 0.09 }, at);
        at += 0.2;
        break;
      case 'scale':
        timeline.from(element, { scale: 0.86, opacity: 0, duration: 1.4 }, at);
        break;
      case 'video':
        timeline.from(element, { scale: 1.12, opacity: 0, duration: 1.8, ease: 'power3.out' }, 0);
        break;
      case 'rise':
        timeline.from(element, { y: 140, rotateX: 14, transformPerspective: 1600, opacity: 0, duration: 1.3 }, at);
        at += 0.3;
        break;
      case 'pop':
        timeline.from(element, { scale: 0, opacity: 0, duration: 0.7, ease: 'back.out(2)' }, at + 0.4);
        at += 0.12;
        break;
      case 'left':
      case 'right':
        timeline.from(element, { x: kind === 'left' ? -220 : 220, opacity: 0, duration: 1.2 }, at);
        break;
      case 'fade':
        timeline.from(element, { opacity: 0, duration: 0.8 }, at);
        break;
      case 'pipeline': {
        const nodes = [...element.children];
        gsap.set(nodes, { clearProps: 'opacity,transform,--link' });
        timeline.from(nodes, { y: 50, opacity: 0, duration: 0.8, stagger: 0.22 }, at);
        timeline.from(nodes.slice(1), { '--link': 0, duration: 0.5, ease: 'power2.inOut', stagger: 0.22 }, at + 0.25);
        at += 0.4;
        break;
      }
      case 'map': {
        const items = [...element.querySelectorAll('[data-map-item]')];
        gsap.set(items, { clearProps: 'opacity,transform' });
        timeline.from(items, { scale: 0.7, opacity: 0, transformOrigin: '50% 50%', duration: 0.8, ease: 'back.out(1.7)', stagger: 0.2 }, at);
        break;
      }
      case 'road': {
        const line = element.querySelector('.road-line span');
        const stops = [...element.querySelectorAll('.road-stop')];
        gsap.set(stops, { clearProps: 'opacity,transform' });
        timeline.fromTo(line, { scaleX: 0 }, { scaleX: 1, duration: 1.6, ease: 'power2.inOut' }, at);
        timeline.from(stops, { y: 40, opacity: 0, duration: 0.8, stagger: 0.3 }, at + 0.2);
        break;
      }
      default:
        break;
    }
  }

  for (const counter of slide.querySelectorAll('[data-deck-count]')) {
    const target = Number(counter.dataset.deckCount);
    const decimals = Number(counter.dataset.decimals ?? 0);
    const state = { value: 0 };
    timeline.to(state, {
      value: target,
      duration: 1.6,
      ease: 'power3.out',
      onUpdate: () => { counter.textContent = state.value.toFixed(decimals); },
    }, 0.5);
  }

  const heatmapHost = slide.querySelector('[data-deck-heatmap]');
  if (heatmapHost && !chartPlayed.has('heatmap')) { chartPlayed.add('heatmap'); timeline.call(heatmap.play, [], 0.6); }
  const jetHost = slide.querySelector('[data-deck-jet]');
  if (jetHost && !chartPlayed.has('jet')) { chartPlayed.add('jet'); timeline.call(jetChart.play, [], 0.7); }
  return timeline;
}

function settle(slide) {
  for (const counter of slide.querySelectorAll('[data-deck-count]')) {
    counter.textContent = Number(counter.dataset.deckCount).toFixed(Number(counter.dataset.decimals ?? 0));
  }
  heatmap.play(); jetChart.play();
}

// ───────── Slide-specific life ─────────
function playMedia(slide, on) {
  for (const video of slide.querySelectorAll('video')) {
    if (video.closest('[data-cycle]')) continue;
    if (on && !reduced) {
      video.preload = 'auto';
      video.play().catch(() => {});
    } else video.pause();
  }
}

const cycle = {
  timer: 0,
  step: 0,
  words: ['Just furniture.', 'Not air.', 'Not heat.', 'Not light.'],
  start(slide) {
    const host = slide.querySelector('[data-cycle]');
    if (!host) return;
    const videos = [...host.querySelectorAll('video')];
    const keys = [...slide.querySelectorAll('[data-cycle-key]')];
    const word = slide.querySelector('[data-cycle-word]');
    const show = (step) => {
      videos.forEach((video, i) => {
        const on = i === step;
        video.classList.toggle('is-on', on);
        if (on && !reduced) { video.preload = 'auto'; video.play().catch(() => {}); } else video.pause();
      });
      keys.forEach((key, i) => key.classList.toggle('is-on', i === step));
      if (reduced) { word.textContent = this.words[step]; return; }
      gsap.to(word, {
        yPercent: -100,
        opacity: 0,
        duration: 0.35,
        ease: 'power2.in',
        onComplete: () => {
          word.textContent = this.words[step];
          gsap.fromTo(word, { yPercent: 100, opacity: 0, '--w': 70 }, { yPercent: 0, opacity: 1, '--w': 118, duration: 0.7, ease: 'expo.out' });
        },
      });
    };
    this.step = 0;
    show(0);
    this.timer = setInterval(() => { this.step = (this.step + 1) % videos.length; show(this.step); }, 2800);
  },
  stop() { clearInterval(this.timer); },
};

function loadDemo() {
  const frame = stage.querySelector('[data-demo]');
  if (!frame || frame.querySelector('iframe')) return;
  const iframe = document.createElement('iframe');
  iframe.src = '../../';
  iframe.title = 'RoomShift editor';
  frame.append(iframe);
  frame.querySelector('[data-demo-load]')?.remove();
  frame.querySelector('video')?.pause();
}
stage.querySelector('[data-demo-load]')?.addEventListener('click', (event) => { event.stopPropagation(); loadDemo(); });

// ───────── Navigation ─────────
function updateChrome() {
  progress.style.transform = `scaleX(${(index + 1) / slides.length})`;
  countLabel.textContent = `${index + 1} / ${slides.length}`;
  notesPanel.textContent = slides[index].dataset.notes ?? '';
  history.replaceState(null, '', `#${index + 1}`);
}

function activate(next) {
  const previous = slides[index];
  if (previous) {
    previous.classList.remove('is-active');
    playMedia(previous, false);
    if (previous.querySelector('[data-cycle]')) cycle.stop();
  }
  index = next;
  const slide = slides[index];
  slide.classList.add('is-active');
  playMedia(slide, true);
  if (slide.querySelector('[data-cycle]')) cycle.start(slide);
  updateChrome();
  return slide;
}

function go(next, { instant = false } = {}) {
  next = Math.max(0, Math.min(slides.length - 1, next));
  if (next === index) return;
  if (transition) transition.progress(1);
  const forward = next > index;
  if (instant || reduced || index === -1) {
    const slide = activate(next);
    if (reduced) settle(slide);
    else transition = enter(slide);
    return;
  }
  const from = forward ? '-101%' : '101%';
  const to = forward ? '101%' : '-101%';
  transition = gsap.timeline({ onComplete: () => { transition = null; } })
    .fromTo(wipe, { x: from }, { x: '0%', duration: 0.55, ease: 'power3.inOut', stagger: 0.08 })
    .add(() => {
      const slide = activate(next);
      enterTimeline = enter(slide);
      enterTimeline.pause();
    })
    .to(wipe, { x: to, duration: 0.6, ease: 'power3.inOut', stagger: { each: 0.08, from: 'end' } })
    .add(() => enterTimeline.play(), '-=0.45');
}
let enterTimeline = null;

const next = () => go(index + 1);
const prev = () => go(index - 1);

document.addEventListener('keydown', (event) => {
  if (event.target.closest('iframe, input, textarea')) return;
  const key = event.key;
  if (['ArrowRight', 'ArrowDown', 'PageDown', ' ', 'Enter'].includes(key)) { event.preventDefault(); if (overview) toggleOverview(false); else next(); }
  else if (['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace'].includes(key)) { event.preventDefault(); prev(); }
  else if (key === 'Home') go(0);
  else if (key === 'End') go(slides.length - 1);
  else if (key === 'o' || key === 'O' || (key === 'Escape' && overview)) toggleOverview();
  else if (key === 'Escape' && !document.fullscreenElement) window.location.href = '../';
  else if (key === 'n' || key === 'N') toggleNotes();
  else if (key === 'f' || key === 'F') toggleFullscreen();
  else if (key === 'l' || key === 'L') loadDemo();
  else if (key === 'e' || key === 'E') window.open('../../', '_blank', 'noopener');
  else if (/^[1-9]$/.test(key) && event.altKey) go(Number(key) - 1);
});

stage.addEventListener('click', (event) => {
  if (overview) {
    const slide = event.target.closest('.slide');
    if (slide) { toggleOverview(false); go(slides.indexOf(slide), { instant: true }); }
    return;
  }
  if (event.target.closest('a, button, iframe, video, .chart, [role="button"]')) return;
  const bounds = deck.getBoundingClientRect();
  if (event.clientX < bounds.width * 0.3) prev(); else next();
});

let touchStart = null;
deck.addEventListener('touchstart', (event) => { touchStart = event.touches[0].clientX; }, { passive: true });
deck.addEventListener('touchend', (event) => {
  if (touchStart === null) return;
  const delta = event.changedTouches[0].clientX - touchStart;
  if (Math.abs(delta) > 50) (delta < 0 ? next : prev)();
  touchStart = null;
});

document.querySelector('[data-next]').addEventListener('click', next);
document.querySelector('[data-prev]').addEventListener('click', prev);
document.querySelector('[data-overview]').addEventListener('click', () => toggleOverview());
notesToggle.addEventListener('click', () => toggleNotes());
document.querySelector('[data-fullscreen]').addEventListener('click', () => toggleFullscreen());

function toggleOverview(force = !overview) {
  overview = force;
  deck.classList.toggle('is-overview', overview);
  if (overview) for (const slide of slides) slide.style.visibility = 'visible';
  else for (const slide of slides) slide.style.visibility = '';
  fit();
  if (overview) slides[index].scrollIntoView({ block: 'center' });
}
function toggleNotes(force = notesPanel.hidden) {
  notesPanel.hidden = !force;
  notesToggle.setAttribute('aria-pressed', String(force));
}
function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen();
  else document.documentElement.requestFullscreen?.().catch(() => {});
}

// Fade the controls when the pointer rests.
let idleTimer = 0;
const wake = () => {
  ui.classList.remove('is-idle');
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => { if (notesPanel.hidden && !overview) ui.classList.add('is-idle'); }, 2600);
};
document.addEventListener('pointermove', wake);
wake();

window.addEventListener('hashchange', () => {
  const target = Number(location.hash.slice(1)) - 1;
  if (Number.isInteger(target) && target !== index) go(target);
});

const initial = Number(location.hash.slice(1)) - 1;
document.fonts.ready.then(() => go(Number.isInteger(initial) && initial >= 0 ? initial : 0, { instant: true }));
