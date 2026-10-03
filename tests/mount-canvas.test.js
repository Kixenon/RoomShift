import test from 'node:test';
import assert from 'node:assert/strict';
import { mountViewportCanvas } from '../src/scene/mount-canvas.js';

test('mounting the room canvas preserves viewport overlays', () => {
  const hint = { id: 'hint' };
  const axes = { id: 'axes' };
  const canvas = { id: 'canvas' };
  const children = [hint, axes];
  const container = {
    get firstChild() { return children[0] ?? null; },
    insertBefore(node, reference) {
      const index = reference ? children.indexOf(reference) : children.length;
      children.splice(index, 0, node);
    },
  };

  mountViewportCanvas(container, canvas);

  assert.deepEqual(children, [canvas, hint, axes]);
});
