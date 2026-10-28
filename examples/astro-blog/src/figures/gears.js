// Two meshing gears in 3D. E3 is the engine; it's set once safis starts in the browser.
import { E3 } from "@safis/core";

export default function gears() {
  const scene = E3.scene();
  const big = scene.add(E3.mesh.gear({ teeth: 30, module: 1, thickness: 4, hole: 2, spokes: 5, bevel: 0.4 }), { name: "wheel" });
  const small = scene.add(E3.mesh.gear({ teeth: 12, module: 1, thickness: 6, hole: 1.2, bevel: 0.4 }), { name: "pinion", material: "brass", position: [21, 0, 0] });
  scene.add(E3.mesh.cylinder(1.6, 14), { material: "steel" });
  scene.add(E3.mesh.cylinder(1, 14), { material: "steel", position: [21, 0, 0] });

  return {
    aspect: 1.6,
    orbit: { yaw: -0.5, pitch: 0.55 },
    state: () => ({ angle: 0 }),
    controls: [
      { key: "cut", label: "Cut open", min: 0, max: 1, step: 0.01, value: 0.35, color: "orange" },
      { key: "speed", label: "Speed", min: 0, max: 1, step: 0.01, value: 0.4, color: "blue" },
    ],
    caption: "A 30-tooth wheel driving a 12-tooth brass pinion. Turn the view by dragging; the pinion turns 2.5 times for each turn of the wheel.",
    step(dt, s, v) { s.angle += dt * v.speed; },
    draw(g, s, v) {
      big.rotation = [0, s.angle, 0];
      small.rotation = [0, (-s.angle * 30) / 12 + Math.PI / 12, 0];
      scene.cutPlane = v.cut > 0 ? [0, 0, 1, 14 * (1 - v.cut) - 2] : null;
      const view = g.render3d(scene, { ...s.view, target: [8, 0, 0] });
      g.callouts([
        { at: view.project([-10, 2, 9]), text: "wheel, 30 teeth" },
        { at: view.project([23, 3, 3]), text: "pinion, 12 teeth", color: "brass" },
      ]);
    },
  };
}
