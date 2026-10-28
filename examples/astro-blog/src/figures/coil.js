// A coil spring in 3D, squeezed by a weight. E3 is set once safis starts in the browser.
import { E3 } from "@safis/core";

export default function coil() {
  const scene = E3.scene();
  const H = 12; // relaxed height of the coil
  const spring = scene.add(E3.mesh.helix(3, H / 8, 8, 0.45), { name: "spring", material: "steel" });
  const weight = scene.add(E3.mesh.box(9, 3, 9, { round: 0.6 }), { name: "weight", material: "brass" });
  scene.add(E3.mesh.box(12, 1, 12, { round: 0.3 }), { name: "base", position: [0, -0.5, 0] });
  scene.shadow = true;

  return {
    aspect: 1.4,
    orbit: { yaw: -0.6, pitch: 0.35 },
    controls: [{ key: "load", label: "Weight", min: 0, max: 40, step: 0.5, value: 12, unit: "N", color: "orange" }],
    caption: "A steel coil under a brass weight. Turn it by dragging; the spring shortens in proportion to the weight.",
    draw(g, s, v) {
      const k = 5; // N per unit of squeeze
      const h = Math.max(2.5, H - v.load / k);
      spring.scale = [1, h / H, 1];
      weight.position = [0, h + 1.5, 0];
      const view = g.render3d(scene, { ...s.view, target: [0, 6, 0] });
      g.callouts([{ at: view.project([4, h / 2, 0]), text: `shorter by ${(H - h).toFixed(1)}`, color: "orange" }]);
    },
  };
}
