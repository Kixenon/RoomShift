import * as THREE from 'three';

// See the layout in your real room: export the furniture at true scale.
// USDZ opens in AR Quick Look on iPhone/iPad (AirDrop or open in Safari, tap the
// AR button); GLB opens in Android Scene Viewer, Windows 3D Viewer, Blender, etc.
// Only furniture, openings and the floor outline are exported, centred on the
// room so the model lands where you stand.

function exportGroup(viewport) {
  const group = new THREE.Group();
  for (const object of viewport.groups.values()) {
    const copy = object.clone(true);
    copy.traverse((child) => {
      if (!child.isMesh) return;
      // Exporters need standard materials and real colours (not the grey light preview).
      const source = child.material;
      const material = new THREE.MeshStandardMaterial({
        color: source.userData?.roomShiftColor ?? source.color ?? new THREE.Color(0xcccccc),
        roughness: source.roughness ?? 0.7,
        metalness: source.metalness ?? 0,
        transparent: source.transparent,
        opacity: source.userData?.roomShiftOpacity ?? source.opacity ?? 1,
      });
      child.material = material;
    });
    group.add(copy);
  }
  // Floor outline as a thin rug so the footprint is visible in AR.
  const { width, depth } = viewport.roomScene.room;
  const outline = new THREE.Mesh(new THREE.PlaneGeometry(width, depth), new THREE.MeshStandardMaterial({ color: 0x3d63dd, transparent: true, opacity: 0.18 }));
  outline.rotation.x = -Math.PI / 2;
  outline.position.y = 0.002;
  group.add(outline);
  return group;
}

export async function exportScene(viewport, format) {
  const group = exportGroup(viewport);
  if (format === 'usdz') {
    const { USDZExporter } = await import('three/addons/exporters/USDZExporter.js');
    return new Blob([await new USDZExporter().parseAsync(group)], { type: 'model/vnd.usdz+zip' });
  }
  const { GLTFExporter } = await import('three/addons/exporters/GLTFExporter.js');
  return new Blob([await new GLTFExporter().parseAsync(group, { binary: true })], { type: 'model/gltf-binary' });
}

export function installArExport(app) {
  async function run(format) {
    app.toast(`Preparing ${format.toUpperCase()}…`, { timeout: 1500 });
    try {
      const blob = await exportScene(app.viewport, format);
      app.downloadBlob(blob, `${app.fileSlug(app.project.name)}.${format}`);
      app.toast(format === 'usdz'
        ? 'AirDrop the .usdz to your iPhone and tap it — it opens in AR at real size'
        : 'GLB saved — open it on Android (Scene Viewer) or in any 3D app', { timeout: 7000 });
    } catch (error) {
      app.toast(`Export failed: ${error.message}`, { tone: 'warn' });
    }
  }
  app.exportAr = run;
  app.addPaletteCommands(() => [
    { label: 'View in AR on iPhone (export USDZ)', group: 'Share', icon: '◳', run: () => run('usdz') },
    { label: 'Export 3D model (GLB)', group: 'Share', icon: '◳', run: () => run('glb') },
  ]);
}
