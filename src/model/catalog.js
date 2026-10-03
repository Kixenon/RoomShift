// Popular real products at approximate published sizes (metres), so a layout
// can be tried with the pieces people actually buy. Check the retailer's page
// before buying — ranges change.
export const CATALOG = Object.freeze([
  { name: 'IKEA MALM bed, double', style: { headboard: 'low', base: 'storage' }, model: 'bed', dimensions: { width: 1.76, height: 0.6, depth: 2.09 }, color: '#d9cbb3' },
  { name: 'IKEA MALM bed, single', style: { headboard: 'low', base: 'storage' }, model: 'bed', dimensions: { width: 1.06, height: 0.6, depth: 2.09 }, color: '#d9cbb3' },
  { name: 'IKEA KIVIK 3-seat sofa', style: { arms: 'both', back: 'high' }, model: 'sofa', dimensions: { width: 2.28, height: 0.83, depth: 0.95 }, color: '#8c8f93' },
  { name: 'IKEA EKTORP 2-seat sofa', style: { arms: 'both', back: 'high' }, model: 'sofa', dimensions: { width: 1.79, height: 0.88, depth: 0.88 }, color: '#e6e1d6' },
  { name: 'IKEA POÄNG armchair', style: { arms: 'both', back: 'high' }, model: 'sofa', dimensions: { width: 0.68, height: 1.0, depth: 0.82 }, color: '#c9b48e' },
  { name: 'IKEA MICKE desk', style: { legs: 'drawers' }, model: 'desk', dimensions: { width: 1.05, height: 0.75, depth: 0.5 }, color: '#f2f2ef' },
  { name: 'IKEA LAGKAPTEN / ALEX desk', style: { legs: 'drawers' }, model: 'desk', dimensions: { width: 1.2, height: 0.73, depth: 0.6 }, color: '#f2f2ef' },
  { name: 'IKEA MARKUS office chair', style: { kind: 'office' }, model: 'chair', dimensions: { width: 0.62, height: 1.29, depth: 0.6 }, color: '#3a3d42' },
  { name: 'IKEA LACK coffee table', style: { shape: 'rect', legs: 'four' }, model: 'table', dimensions: { width: 0.9, height: 0.45, depth: 0.55 }, color: '#2f2f2f' },
  { name: 'IKEA LACK side table', style: { shape: 'rect', legs: 'four' }, model: 'table', dimensions: { width: 0.55, height: 0.45, depth: 0.55 }, color: '#f2f2ef' },
  { name: 'IKEA KALLAX shelf 2×4', style: { kind: 'cube' }, model: 'shelf', dimensions: { width: 0.77, height: 1.47, depth: 0.39 }, color: '#f2f2ef' },
  { name: 'IKEA KALLAX shelf 4×4', style: { kind: 'cube' }, model: 'shelf', dimensions: { width: 1.47, height: 1.47, depth: 0.39 }, color: '#f2f2ef' },
  { name: 'IKEA BILLY bookcase', style: { kind: 'open' }, model: 'shelf', dimensions: { width: 0.8, height: 2.02, depth: 0.28 }, color: '#f2f2ef' },
  { name: 'IKEA PAX wardrobe 100 cm', style: { doors: '2', opening: 'hinged' }, model: 'wardrobe', dimensions: { width: 1.0, height: 2.01, depth: 0.58 }, color: '#f2f2ef' },
  { name: 'IKEA BRIMNES wardrobe', style: { doors: '3', opening: 'hinged', mirror: 'yes' }, model: 'wardrobe', dimensions: { width: 0.78, height: 1.9, depth: 0.5 }, color: '#f2f2ef' },
  { name: 'IKEA HEKTAR floor lamp', style: { kind: 'floor' }, model: 'lamp', dimensions: { width: 0.4, height: 1.81, depth: 0.4 }, color: '#4a4c4f' },
  { name: 'IKEA TERTIAL desk lamp', model: 'deskLamp', dimensions: { width: 0.17, height: 0.45, depth: 0.17 }, color: '#e8e8e4' },
  { name: '55″ TV', model: 'tv', dimensions: { width: 1.23, height: 0.71, depth: 0.06 } },
  { name: 'Pedestal fan 40 cm', model: 'fan', dimensions: { width: 0.42, height: 1.3, depth: 0.42 } },
  { name: 'Split AC 1.5 hp', model: 'ac', dimensions: { width: 0.85, height: 0.29, depth: 0.22 } },
  { name: 'Oil-filled radiator 2 kW', model: 'heater', dimensions: { width: 0.6, height: 0.65, depth: 0.25 }, props: { watts: 2000 } },
]);
