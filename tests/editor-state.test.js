import test from 'node:test';
import assert from 'node:assert/strict';
import { createEditorState, resetEditorState, selectObject, setTransformMode, setView } from '../src/model/editor-state.js';

test('reset restores the default room, view, transform mode, and selection', () => {
  const initial = createEditorState();
  const rotated = setTransformMode(setView(selectObject(initial, 'fan-1'), 'top'), 'rotate');
  const reset = resetEditorState(rotated);

  assert.deepEqual(reset, {
    scene: initial.scene,
    selectedId: null,
    view: '3d',
    transformMode: 'translate',
  });
});
