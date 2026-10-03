import { initMotion, initHeader, stretchIn } from './motion.js';

initHeader();
document.querySelector('[data-nav-toggle]')?.addEventListener('click', () => document.querySelector('.site-nav').classList.toggle('is-open'));
stretchIn(document.querySelector('[data-stretch]'), { delay: 0.1 });
initMotion();
