import test from 'node:test';
import assert from 'node:assert/strict';
import { createEditorState, resetEditorState, selectObject, setTransformMode } from '../src/model/editor-state.js';

test('reset restores the default room, transform mode, and selection', () => {
  const initial = createEditorState();
  const rotated = setTransformMode(selectObject(initial, 'fan-1'), 'rotate');
  const reset = resetEditorState(rotated);

  assert.deepEqual(reset, {
    scene: initial.scene,
    selectedId: null,
    transformMode: 'translate',
  });
});
