// Guided plans: pick what you're trying to do and RoomShift turns it into a
// checklist. Steps tick themselves off from the room's state and what you've
// done, and each one has a button that takes you straight to the tool.

const has = (report, pattern) => (report?.issues ?? []).some((issue) => pattern.test(issue.text));

export const JOURNEYS = Object.freeze({
  movein: {
    title: 'Moving into a hall or dorm',
    persona: 'Student',
    blurb: 'You’ve got a room you’ve never seen, a bed, a desk, a fan, and one weekend.',
    template: 'hall',
    steps: [
      { label: 'Get the room’s real size', hint: 'Photo, scan, floor plan, or draw it', done: (ctx) => ctx.seen.has('room-size'), action: (app) => app.openSheet('room', { toggle: false }) },
      { label: 'Add what you’re bringing', hint: 'Drag from the dock or snap a photo', done: (ctx) => ctx.scene.objects.length > ctx.startObjects, action: () => document.querySelector('[data-dock-tab="furniture"]')?.click() },
      { label: 'Keep a path to the door and bed', hint: 'Suggest layout can do it for you', done: (ctx) => ctx.report && ctx.report.categories.space.score >= 85, action: (app) => app.actions['suggest-layout']() },
      { label: 'Aim the fan where you sleep or work', hint: 'Air lens shows the jet', done: (ctx) => ctx.seen.has('lens:airflow') && !has(ctx.report, /isn't aimed/), action: (app) => app.setLens('airflow') },
      { label: 'Check WiFi at the desk', hint: 'WiFi lens, drag the router', done: (ctx) => ctx.seen.has('lens:wifi') && !has(ctx.report, /Weak WiFi/), action: (app) => app.setLens('wifi') },
      { label: 'Save a report to share', hint: 'One page with the score and fixes', done: (ctx) => ctx.seen.has('report'), action: (app) => app.actions.report() },
    ],
  },
  cool: {
    title: 'My room is too hot or stuffy',
    persona: 'Renter in summer',
    blurb: 'Find where the heat comes from and get air moving before buying another fan.',
    template: 'studio',
    steps: [
      { label: 'Fetch today’s weather', hint: 'Real wind and temperature outside', done: (ctx) => ctx.seen.has('weather'), action: (app) => { app.openSheet('site', { toggle: false }); document.querySelector('#weather-refresh')?.click(); } },
      { label: 'Look at air and heat together', hint: 'Shift-click combines lenses', done: (ctx) => ctx.seen.has('lens:airflow') && ctx.seen.has('lens:temperature'), action: (app) => { app.setLens('airflow'); app.setLens('temperature', { additive: true }); } },
      { label: 'Open windows on two walls', hint: 'Cross-ventilation beats one window', done: (ctx) => ctx.air?.mode === 'cross', action: () => document.querySelector('[data-dock-tab="opening"]')?.click() },
      { label: 'Point the fan at people', hint: 'Turn its head in the card', done: (ctx) => ctx.scene.objects.some((object) => object.model === 'fan') && !has(ctx.report, /isn't aimed/), action: (app) => app.setLens('airflow') },
      { label: 'Make the seats comfortable', hint: 'ISO 7730 comfort in the Heat lens', done: (ctx) => ctx.report && !has(ctx.report, /warm for|hot for/), action: (app) => app.setLens('temperature') },
      { label: 'Shade the sunny window', hint: 'Blinds or curtains cut solar gain', done: (ctx) => ctx.report && !has(ctx.report, /lets in .* W of sun/), action: (app) => app.setLens('light') },
    ],
  },
  wfh: {
    title: 'Setting up to work from home',
    persona: 'Remote worker',
    blurb: 'Good light without glare, a strong signal, a quiet call, and a chair that fits.',
    template: 'office',
    steps: [
      { label: 'Daylight on the desk, no glare', hint: 'Light lens; turn the desk side-on to the window', done: (ctx) => ctx.seen.has('lens:light') && !has(ctx.report, /strains your eyes|reflect in the screen/), action: (app) => app.setLens('light') },
      { label: '300 lux on the desk after dark', hint: 'Add a desk lamp', done: (ctx) => ctx.report && !has(ctx.report, /add a desk lamp/), action: (app) => app.placeModel('deskLamp') },
      { label: 'Strong WiFi at the desk', hint: 'Raise the router, keep metal away', done: (ctx) => ctx.seen.has('lens:wifi') && !has(ctx.report, /Weak WiFi at Desk|is on the floor/), action: (app) => app.setLens('wifi') },
      { label: 'A chair at every desk', hint: '', done: (ctx) => ctx.report && !has(ctx.report, /has no chair/), action: (app) => app.placeModel('chair') },
      { label: 'Calm the echo for calls', hint: 'Sound lens; soft finishes help', done: (ctx) => ctx.seen.has('lens:sound') && ctx.rt60 < 0.7, action: (app) => app.setLens('sound') },
    ],
  },
  sleep: {
    title: 'Sleeping better',
    persona: 'Light sleeper',
    blurb: 'Dark, quiet, the right temperature, and a bed that feels anchored.',
    template: 'hall',
    steps: [
      { label: 'Headboard against a wall', hint: 'Rotate or move the bed', done: (ctx) => ctx.report && !has(ctx.report, /headboard isn't against/), action: (app) => app.selectModel('bed') },
      { label: 'Blackout on bedroom windows', hint: 'Select a window → Covering', done: (ctx) => ctx.scene.objects.filter((object) => object.model === 'window').every((window) => window.props?.covering === 'blackout'), action: (app) => app.selectModel('window') },
      { label: 'Quiet enough at night', hint: 'Set the street noise in Site', done: (ctx) => ctx.seen.has('site') && !has(ctx.report, /Outside noise reaches/), action: (app) => app.openSheet('site', { toggle: false }) },
      { label: 'Comfortable under the duvet', hint: 'Heat lens comfort table', done: (ctx) => ctx.report && !has(ctx.report, /Bed: /), action: (app) => app.setLens('temperature') },
      { label: 'No hum or drafts at the bed', hint: 'Fridge, AC and open windows', done: (ctx) => ctx.report && !has(ctx.report, /hums within|blows straight onto|street noise and drafts/), action: (app) => app.openSheet('insights', { toggle: false }) },
    ],
  },
  designer: {
    title: 'Comparing layouts for a client',
    persona: 'Interior designer',
    blurb: 'Two or three arrangements, side by side, and a report the client understands.',
    template: 'living',
    steps: [
      { label: 'Make a second layout', hint: 'Shift+N, then move things', done: (ctx) => (ctx.project.variants?.length ?? 0) >= 2, action: () => document.querySelector('#variant-chip')?.click() },
      { label: 'Let RoomShift try one too', hint: 'Suggest layout', done: (ctx) => ctx.seen.has('suggest'), action: (app) => app.actions['suggest-layout']() },
      { label: 'Compare them side by side', hint: 'Every lens, one table', done: (ctx) => ctx.seen.has('compare'), action: (app) => app.actions.compare() },
      { label: 'Export the client report', hint: 'Print or save as PDF', done: (ctx) => ctx.seen.has('report'), action: (app) => app.actions.report() },
    ],
  },
});

export function installJourneys(app) {
  const chooser = document.createElement('dialog');
  chooser.className = 'dialog wide';
  chooser.innerHTML = `<div class="dialog-body">
    <h2>What are you planning?</h2>
    <p class="muted">RoomShift turns it into a short checklist and points you at the right tools.</p>
    <div class="journey-grid">${Object.entries(JOURNEYS).map(([key, journey]) => `
      <button type="button" class="journey-card" data-journey="${key}"><span class="persona">${journey.persona}</span><strong>${journey.title}</strong><span>${journey.blurb}</span></button>`).join('')}</div>
    <div class="dialog-actions"><button class="btn ghost" type="button" data-journey="">Just explore</button></div>
  </div>`;
  document.body.append(chooser);

  const panel = document.createElement('section');
  panel.className = 'journey-panel';
  document.querySelector('#outline').prepend(panel);

  const seen = new Set();
  let startObjects = 0;
  app.track = (event) => {
    if (seen.has(event)) return;
    seen.add(event);
    render();
  };

  function context() {
    return { app, project: app.project, scene: app.scene, report: app.layoutReport, seen, startObjects, air: app.ventilation?.(), rt60: app.rt60?.() ?? 1 };
  }

  function render() {
    const key = app.project?.journey;
    const journey = JOURNEYS[key];
    if (!journey || !app.scene) {
      panel.innerHTML = `<button type="button" class="journey-start" data-open-chooser>✦ Choose a guided plan</button>`;
      return;
    }
    const ctx = context();
    const states = journey.steps.map((step) => { try { return step.done(ctx); } catch { return false; } });
    const done = states.filter(Boolean).length;
    const next = states.indexOf(false);
    panel.innerHTML = `<div class="journey-head"><span class="label">${journey.title}</span><button type="button" class="icon-btn small" data-open-chooser title="Change plan">⋯</button></div>
      <div class="journey-progress"><i style="width:${(done / journey.steps.length) * 100}%"></i></div>
      <ol class="journey-steps">${journey.steps.map((step, index) => `<li class="${states[index] ? 'done' : index === next ? 'next' : ''}">
        <button type="button" data-step="${index}"><span class="tick">${states[index] ? '✓' : index + 1}</span><span><strong>${step.label}</strong>${step.hint && !states[index] ? `<small>${step.hint}</small>` : ''}</span></button></li>`).join('')}</ol>
      ${done === journey.steps.length ? '<p class="journey-done">All done — this room is ready. Export a report to keep it.</p>' : ''}`;
  }

  panel.addEventListener('click', (event) => {
    if (event.target.closest('[data-open-chooser]')) { chooser.showModal(); return; }
    const step = event.target.closest('[data-step]');
    const journey = JOURNEYS[app.project?.journey];
    if (step && journey) journey.steps[Number(step.dataset.step)].action(app);
  });
  chooser.addEventListener('click', (event) => {
    const card = event.target.closest('[data-journey]');
    if (!card) { if (event.target === chooser) chooser.close(); return; }
    app.setProject({ journey: card.dataset.journey || 'none' });
    chooser.close();
    render();
  });

  app.onOpen.push((project) => {
    seen.clear();
    startObjects = project.scene.objects.length;
    render();
    // New rooms ask once; existing ones keep their plan.
    if (!project.journey && Date.now() - project.createdAt < 8000) setTimeout(() => chooser.showModal(), 400);
  });
  app.onChange.push(render);
  app.addPaletteCommands(() => [{ label: 'Choose a guided plan', group: 'Help', icon: '✦', run: () => chooser.showModal() }]);
}
