/**
 * Day/Night Cycle - Controls sun, moon, sky, and lighting over time.
 *
 * Time runs 0-24 hours. 1 full day = ~8 minutes real time.
 * Smoothly interpolates sky colors, light direction, intensity, and fog.
 * Moon provides faint blue-white light at night.
 */

import { Scene } from '@babylonjs/core/scene';
import { Vector3, Color3, Color4 } from '@babylonjs/core/Maths/math';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';

// Time settings
const DAY_DURATION = 480; // Seconds for a full 24-hour cycle (8 minutes)

// Sky color keyframes [hour, R, G, B]
const SKY_COLORS: [number, number, number, number][] = [
  [0,   0.02, 0.02, 0.08],  // Midnight - deep dark blue
  [4,   0.05, 0.05, 0.15],  // Pre-dawn - very dark blue
  [5.5, 0.35, 0.20, 0.30],  // Dawn - purple-pink
  [6.5, 0.70, 0.45, 0.30],  // Sunrise - orange-pink
  [8,   0.40, 0.60, 0.90],  // Morning - blue
  [12,  0.45, 0.65, 0.95],  // Noon - bright blue
  [16,  0.45, 0.60, 0.85],  // Afternoon - blue
  [18,  0.85, 0.50, 0.25],  // Sunset - golden orange
  [19.5,0.50, 0.20, 0.30],  // Dusk - deep orange-purple
  [21,  0.08, 0.05, 0.18],  // Evening - dark purple
  [24,  0.02, 0.02, 0.08],  // Midnight again
];

// Fog color keyframes [hour, R, G, B]
const FOG_COLORS: [number, number, number, number][] = [
  [0,   0.02, 0.02, 0.06],
  [5.5, 0.25, 0.15, 0.25],
  [6.5, 0.80, 0.55, 0.35],
  [8,   0.60, 0.70, 0.85],
  [12,  0.65, 0.75, 0.90],
  [18,  0.85, 0.60, 0.35],
  [19.5,0.40, 0.18, 0.25],
  [21,  0.05, 0.04, 0.12],
  [24,  0.02, 0.02, 0.06],
];

// Sun intensity keyframes [hour, intensity]
const SUN_INTENSITY: [number, number][] = [
  [0,   0.0],
  [5,   0.0],
  [6,   0.3],
  [7,   0.7],
  [10,  1.0],
  [16,  1.0],
  [18,  0.8],
  [19,  0.4],
  [20,  0.0],
  [24,  0.0],
];

export class DayNightCycle {
  private scene: Scene;
  private timeOfDay: number;     // 0-24 hours
  private timeSpeed: number;     // Hours per second

  // Lights
  private sunLight: DirectionalLight;
  private ambientLight: HemisphericLight;
  private moonLight: DirectionalLight;

  // Sky objects
  private skyMaterial: StandardMaterial;
  private sunMesh: Mesh;
  private sunGlowMesh: Mesh;
  private moonMesh: Mesh;

  // Building material references for night glow
  private buildingMaterials: StandardMaterial[] = [];

  // Reusable
  private _tmpColor = new Color3();

  constructor(
    scene: Scene,
    sunLight: DirectionalLight,
    ambientLight: HemisphericLight,
    startHour: number = 17 // Start at late afternoon
  ) {
    this.scene = scene;
    this.sunLight = sunLight;
    this.ambientLight = ambientLight;
    this.timeOfDay = startHour;
    this.timeSpeed = 24 / DAY_DURATION;

    // Create moon directional light (faint blue-white)
    this.moonLight = new DirectionalLight('moonLight', new Vector3(0.5, -0.3, 0.5), scene);
    this.moonLight.intensity = 0;
    this.moonLight.diffuse = new Color3(0.4, 0.45, 0.7);
    this.moonLight.specular = new Color3(0.2, 0.2, 0.4);

    // Find meshes created by scene.ts (NOT creating duplicates)
    this.skyMaterial = (scene.getMeshByName('skyDome')?.material as StandardMaterial) || null!;
    this.sunMesh = scene.getMeshByName('sunDisc') as Mesh;
    this.sunGlowMesh = scene.getMeshByName('sunGlow') as Mesh;

    // Create moon mesh
    this.moonMesh = MeshBuilder.CreateSphere('moonDisc', {
      diameter: 80, segments: 12
    }, scene);
    this.moonMesh.infiniteDistance = true;
    const moonMat = new StandardMaterial('moonMat', scene);
    moonMat.disableLighting = true;
    moonMat.emissiveColor = new Color3(0.85, 0.88, 1.0);
    this.moonMesh.material = moonMat;
    this.moonMesh.isPickable = false;
    this.moonMesh.setEnabled(false);
  }

  /**
   * Register building materials so we can add/remove emissive glow at night.
   */
  public setBuildingMaterials(mats: StandardMaterial[]): void {
    this.buildingMaterials = mats;
  }

  public getTimeOfDay(): number {
    return this.timeOfDay;
  }

  public isNight(): boolean {
    return this.timeOfDay < 6 || this.timeOfDay > 20;
  }

  public update(deltaTime: number): void {
    // Advance time
    this.timeOfDay += this.timeSpeed * deltaTime;
    if (this.timeOfDay >= 24) this.timeOfDay -= 24;

    const t = this.timeOfDay;

    // ── Sun position ──
    // Sun rotates in a circle: rises in east (hour 6), sets in west (hour 18)
    const sunAngle = ((t - 6) / 24) * Math.PI * 2; // 0 at sunrise, PI at sunset
    const sunHeight = Math.sin(sunAngle);
    const sunHoriz = Math.cos(sunAngle);
    const sunDir = new Vector3(-sunHoriz, -Math.max(0.05, sunHeight), -0.3).normalize();
    this.sunLight.direction = sunDir;

    // Sun mesh position - massive sun on the horizon
    if (this.sunMesh) {
      const sunVis = sunHeight > -0.05; // Only visible above horizon
      this.sunMesh.setEnabled(sunVis);
      if (this.sunGlowMesh) this.sunGlowMesh.setEnabled(sunVis);
      if (sunVis) {
        this.sunMesh.position.set(
          -sunHoriz * 1500,
          Math.max(10, sunHeight * 800),
          -0.3 * 1500
        );
        if (this.sunGlowMesh) this.sunGlowMesh.position.copyFrom(this.sunMesh.position);
      }
    }

    // ── Moon position ── (ONLY when sun is fully below horizon - never both)
    const moonVisible = sunHeight < -0.1;
    this.moonMesh.setEnabled(moonVisible);
    if (moonVisible) {
      const moonAngle = sunAngle + Math.PI;
      const moonH = Math.sin(moonAngle);
      const moonHz = Math.cos(moonAngle);
      this.moonMesh.position.set(moonHz * 1200, Math.max(50, moonH * 600), 0.3 * 1200);
      this.moonLight.direction = new Vector3(-moonHz, -Math.max(0.1, moonH), -0.3).normalize();
    }

    // ── Interpolate sky color ──
    const skyColor = this.interpolateKeyframes(SKY_COLORS, t);
    if (this.skyMaterial) {
      this.skyMaterial.emissiveColor.set(skyColor[0], skyColor[1], skyColor[2]);
    }
    this.scene.clearColor.set(skyColor[0], skyColor[1], skyColor[2], 1.0);

    // ── Interpolate fog ──
    const fogColor = this.interpolateKeyframes(FOG_COLORS, t);
    this.scene.fogColor.set(fogColor[0], fogColor[1], fogColor[2]);

    // Fog gets denser at night (harder to see far)
    const nightFactor = 1 - Math.max(0, Math.min(1, sunHeight * 2));
    this.scene.fogDensity = 0.00035 + nightFactor * 0.0003;

    // ── Sun light intensity and color ──
    const sunIntensity = this.interpolateValue(SUN_INTENSITY, t);
    this.sunLight.intensity = sunIntensity;

    // Sun color: white at noon, golden at sunrise/sunset
    const sunColorT = Math.max(0, 1 - sunHeight * 2); // 0 at noon, 1 at horizon
    this.sunLight.diffuse.set(
      1.0,
      0.8 + 0.2 * (1 - sunColorT),
      0.5 + 0.5 * (1 - sunColorT)
    );

    // ── Moon light (only light source at night besides street lights) ──
    this.moonLight.intensity = moonVisible ? 0.2 * Math.min(1, Math.abs(sunHeight) * 3) : 0;

    // ── Ambient light - kept LOW so sun dominates ──
    // Day: subtle sky fill. Night: almost nothing (moonlight only).
    const ambientDay = Math.max(0.03, sunIntensity * 0.25);
    this.ambientLight.intensity = ambientDay + (moonVisible ? 0.04 : 0);

    if (sunIntensity > 0.1) {
      this.ambientLight.diffuse.set(0.7, 0.75, 0.9);   // Cool sky bounce
      this.ambientLight.groundColor.set(0.12, 0.1, 0.15);
    } else {
      this.ambientLight.diffuse.set(0.1, 0.1, 0.25);    // Dark blue night
      this.ambientLight.groundColor.set(0.02, 0.02, 0.05);
    }

    // ── Building window glow at night ──
    const isNight = t > 19 || t < 5.5;
    const glowIntensity = isNight ? 0.08 : 0;
    for (const mat of this.buildingMaterials) {
      // Warm yellow window glow
      mat.emissiveColor.set(glowIntensity * 1.0, glowIntensity * 0.8, glowIntensity * 0.3);
    }
  }

  private interpolateKeyframes(keyframes: [number, number, number, number][], t: number): [number, number, number] {
    // Find surrounding keyframes
    let lower = keyframes[0];
    let upper = keyframes[keyframes.length - 1];

    for (let i = 0; i < keyframes.length - 1; i++) {
      if (t >= keyframes[i][0] && t <= keyframes[i + 1][0]) {
        lower = keyframes[i];
        upper = keyframes[i + 1];
        break;
      }
    }

    const range = upper[0] - lower[0];
    const frac = range > 0 ? (t - lower[0]) / range : 0;

    return [
      lower[1] + (upper[1] - lower[1]) * frac,
      lower[2] + (upper[2] - lower[2]) * frac,
      lower[3] + (upper[3] - lower[3]) * frac,
    ];
  }

  private interpolateValue(keyframes: [number, number][], t: number): number {
    let lower = keyframes[0];
    let upper = keyframes[keyframes.length - 1];

    for (let i = 0; i < keyframes.length - 1; i++) {
      if (t >= keyframes[i][0] && t <= keyframes[i + 1][0]) {
        lower = keyframes[i];
        upper = keyframes[i + 1];
        break;
      }
    }

    const range = upper[0] - lower[0];
    const frac = range > 0 ? (t - lower[0]) / range : 0;
    return lower[1] + (upper[1] - lower[1]) * frac;
  }
}
