// Material properties shared by rendering and the WiFi / sound estimates.
// Values are typical textbook figures, not measurements of a specific product:
// - wifiLossDb: extra 2.4/5 GHz attenuation when a signal passes through the object.
// - absorption: sound absorption coefficient around 500 Hz–1 kHz (0 = reflects everything).
// - soundBlockDb: rough insertion loss when the object sits between a speaker and a listener.
// - reflectance: diffuse light reflectance used to tint the light preview.
export const MATERIALS = Object.freeze({
  wood: { label: 'Wood', roughness: 0.7, metalness: 0, wifiLossDb: 3, absorption: 0.1, soundBlockDb: 6, reflectance: 0.45 },
  fabric: { label: 'Fabric', roughness: 0.95, metalness: 0, wifiLossDb: 2, absorption: 0.6, soundBlockDb: 4, reflectance: 0.4 },
  metal: { label: 'Metal', roughness: 0.35, metalness: 0.8, wifiLossDb: 22, absorption: 0.05, soundBlockDb: 10, reflectance: 0.6 },
  glass: { label: 'Glass', roughness: 0.1, metalness: 0, wifiLossDb: 4, absorption: 0.04, soundBlockDb: 5, reflectance: 0.1 },
  plastic: { label: 'Plastic', roughness: 0.5, metalness: 0, wifiLossDb: 2, absorption: 0.05, soundBlockDb: 3, reflectance: 0.55 },
  stone: { label: 'Stone / ceramic', roughness: 0.6, metalness: 0, wifiLossDb: 12, absorption: 0.02, soundBlockDb: 9, reflectance: 0.5 },
  plant: { label: 'Plant (water)', roughness: 0.9, metalness: 0, wifiLossDb: 6, absorption: 0.3, soundBlockDb: 2, reflectance: 0.2 },
});

export const SURFACE_MATERIALS = Object.freeze({
  floor: {
    wood: { label: 'Wood floor', absorption: 0.07, reflectance: 0.35, color: 0xd9c7a8 },
    tile: { label: 'Tile', absorption: 0.02, reflectance: 0.55, color: 0xe6e4dc },
    carpet: { label: 'Carpet', absorption: 0.35, reflectance: 0.3, color: 0xc9c2b4 },
    vinyl: { label: 'Vinyl', absorption: 0.03, reflectance: 0.45, color: 0xe0dccd },
  },
  walls: {
    paint: { label: 'Painted plaster', absorption: 0.03, reflectance: 0.8, color: 0xf9fbf6 },
    concrete: { label: 'Bare concrete', absorption: 0.02, reflectance: 0.4, color: 0xd5d6d2 },
    wood: { label: 'Wood panels', absorption: 0.1, reflectance: 0.45, color: 0xe2cfae },
    acoustic: { label: 'Acoustic panels', absorption: 0.7, reflectance: 0.6, color: 0xe7e9ee },
  },
});

export const DEFAULT_SURFACES = Object.freeze({ floor: 'wood', walls: 'paint' });

export function sceneSurfaces(scene) {
  return { ...DEFAULT_SURFACES, ...(scene.surfaces ?? {}) };
}
