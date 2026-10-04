import { createRoomScene } from './room-scene.js';

export function createEditorState(scene = createRoomScene()) {
  return {
    scene,
    selectedId: null,
    transformMode: 'translate',
  };
}

export function selectObject(state, objectId) {
  if (objectId !== null && !state.scene.objects.some((object) => object.id === objectId)) {
    throw new RangeError(`Unknown object: ${objectId}`);
  }
  return { ...state, selectedId: objectId };
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
