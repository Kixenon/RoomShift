// Shared motion for the RoomShift pages: headline splits, scroll reveals and counters.
// Everything renders in its final state when reduced motion is requested.
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { SplitText } from 'gsap/SplitText';

gsap.registerPlugin(ScrollTrigger, SplitText);

export { gsap, ScrollTrigger, SplitText };
export const prefersReducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// Hero-style headline: characters rise out of a mask while their width axis stretches open.
export function stretchIn(element, { delay = 0, stagger = 0.028 } = {}) {
  if (!element || prefersReducedMotion()) return null;
  const split = SplitText.create(element, { type: 'words,chars', mask: 'words', charsClass: 'char' });
  return gsap.from(split.chars, {
    yPercent: 110,
    '--w': 62,
    duration: 1.1,
    ease: 'expo.out',
    stagger,
    delay,
    onComplete: () => split.revert(),
  });
}

// Section headlines: lines slide up from a mask as they enter.
function revealHeadlines(scope) {
  for (const element of scope.querySelectorAll('[data-split]')) {
    SplitText.create(element, {
      type: 'lines',
      mask: 'lines',
      autoSplit: true,
      onSplit: (self) => gsap.from(self.lines, {
        yPercent: 105,
        duration: 0.9,
        ease: 'expo.out',
        stagger: 0.09,
        scrollTrigger: { trigger: element, start: 'top 86%', once: true },
      }),
    });
  }
}

// Groups whose children fade up in sequence.
function revealGroups(scope) {
  for (const group of scope.querySelectorAll('[data-reveal]')) {
    const targets = group.dataset.reveal === 'self' ? [group] : [...group.children];
    gsap.from(targets, {
      opacity: 0,
      y: 28,
      duration: 0.8,
      ease: 'power3.out',
      stagger: 0.08,
      scrollTrigger: { trigger: group, start: 'top 85%', once: true },
    });
  }
}

// Numbers that count up once, keeping their formatting.
export function countUp(element, { duration = 1.6, delay = 0, trigger = element.closest('[data-reveal], section') ?? element } = {}) {
  const target = Number(element.dataset.count);
  const decimals = Number(element.dataset.decimals ?? 0);
  const format = new Intl.NumberFormat('en-CA', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  if (prefersReducedMotion()) {
    element.textContent = format.format(target);
    return null;
  }
  const state = { value: 0 };
  element.textContent = format.format(0);
  return gsap.to(state, {
    value: target,
    duration,
    delay,
    ease: 'power3.out',
    onUpdate: () => { element.textContent = format.format(state.value); },
    scrollTrigger: trigger ? { trigger, start: 'top 80%', once: true } : undefined,
  });
}

export function initMotion(scope = document) {
  if (prefersReducedMotion()) {
    for (const element of scope.querySelectorAll('[data-count]')) countUp(element);
    return;
  }
  revealHeadlines(scope);
  revealGroups(scope);
  for (const element of scope.querySelectorAll('[data-count]')) countUp(element);
  window.addEventListener('load', () => ScrollTrigger.refresh());
}

// Sticky header border and the current page's section link.
export function initHeader() {
  const header = document.querySelector('.site-header');
  if (!header) return;
  const onScroll = () => header.classList.toggle('is-scrolled', window.scrollY > 8);
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
}
