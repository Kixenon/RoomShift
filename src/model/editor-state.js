import { createRoomScene } from './room-scene.js';

export function createEditorState(scene = createRoomScene()) {
  return {
    scene,
    selectedId: null,
    view: '3d',
    transformMode: 'translate',
  };
}

export function selectObject(state, objectId) {
  if (objectId !== null && !state.scene.objects.some((object) => object.id === objectId)) {
    throw new RangeError(`Unknown object: ${objectId}`);
  }
  return { ...state, selectedId: objectId };
}

export function setView(state, view) {
  if (view !== '3d' && view !== 'top') throw new RangeError(`Unsupported view: ${view}`);
  return { ...state, view };
}

export function setTransformMode(state, transformMode) {
  if (transformMode !== 'translate' && transformMode !== 'rotate') {
    throw new RangeError(`Unsupported transform mode: ${transformMode}`);
  }
  return { ...state, transformMode };
}

export function resetEditorState() {
  return createEditorState();
}
