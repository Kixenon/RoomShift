// Measuring tape: click two points (on furniture or the floor) for a dimension
// line. Measurements stay until you clear them; M toggles the tool, Esc leaves it.
export function installMeasure(app) {
  let active = false;
  let pending = null;
  let pairs = [];
  const labels = [];
  const button = document.createElement('button');
  button.className = 'icon-btn';
  button.type = 'button';
  button.title = 'Measure · M';
  button.setAttribute('aria-label', 'Measure distances');
  button.textContent = '📏';
  document.querySelector('#view-home').before(button);

  const distance = ([a, b]) => Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
  function render() {
    app.viewport.setMeasurements(pending ? [...pairs, [pending, null]] : pairs);
    while (labels.length > pairs.length) labels.pop().remove();
    while (labels.length < pairs.length) {
      const label = document.createElement('button');
      label.type = 'button';
      label.className = 'measure-label';
      label.title = 'Click to remove';
      const index = labels.length;
      label.addEventListener('click', () => { pairs.splice(index, 1); render(); });
      document.querySelector('#viewport').append(label);
      labels.push(label);
    }
    pairs.forEach((pair, index) => { labels[index].textContent = `${distance(pair).toFixed(2)} m`; });
    position();
  }
  function position() {
    pairs.forEach(([a, b], index) => {
      const screen = app.viewport.projectRoomPoint({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 });
      if (!screen) return;
      labels[index].hidden = !screen.visible;
      labels[index].style.transform = `translate(${Math.round(screen.x)}px, ${Math.round(screen.y)}px) translate(-50%, -50%)`;
    });
  }
  function setActive(next) {
    active = next;
    pending = null;
    button.classList.toggle('active', active);
    document.querySelector('#viewport').classList.toggle('measuring', active);
    if (active) app.toast('Click two points to measure · Esc to stop', { timeout: 3500 });
    render();
  }
  button.addEventListener('click', () => setActive(!active));
  const intercept = (event) => {
    if (!active) return false;
    const point = app.viewport.pickPoint(event.clientX, event.clientY);
    if (!point) return true;
    if (!pending) pending = point;
    else {
      pairs.push([pending, point]);
      pending = null;
    }
    render();
    return true;
  };
  app.onFrameHandlers.push(() => { if (pairs.length) position(); });
  document.addEventListener('keydown', (event) => {
    if (event.target.matches('input, textarea, select') || document.querySelector('#editor').hidden || document.querySelector('dialog[open]')) return;
    if (event.key === 'm' || event.key === 'M') setActive(!active);
    else if (event.key === 'Escape' && active) setActive(false);
  });
  // The 3D view exists once a room has been opened.
  app.onOpen.push(() => {
    app.viewport.clickInterceptor = intercept;
    pairs = [];
    setActive(false);
  });
  app.addPaletteCommands(() => [
    { label: 'Measure a distance', group: 'View', icon: '📏', keys: 'M', run: () => setActive(true) },
    { label: 'Clear measurements', group: 'View', run: () => { pairs = []; render(); } },
  ]);
}
