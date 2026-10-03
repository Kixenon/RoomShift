import { initMotion, initHeader, stretchIn, gsap, prefersReducedMotion } from './motion.js';

initHeader();
stretchIn(document.querySelector('[data-stretch]'), { delay: 0.1 });

// The market map draws its regions in, then RoomShift drops onto it.
if (!prefersReducedMotion()) {
  const items = document.querySelectorAll('[data-map-item]');
  gsap.from(items, {
    opacity: 0,
    scale: 0.85,
    transformOrigin: '50% 50%',
    duration: 0.7,
    ease: 'back.out(1.6)',
    stagger: 0.18,
    scrollTrigger: { trigger: '[data-map]', start: 'top 75%', once: true },
  });
}

initMotion();
