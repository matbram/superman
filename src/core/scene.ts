/**
 * Scene setup and configuration
 * Handles scene creation, lighting, skybox, and camera setup
 */

import { Scene } from '@babylonjs/core/scene';
import { Engine } from '@babylonjs/core/Engines/engine';
import { Vector3, Color3, Color4 } from '@babylonjs/core/Maths/math';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight';
import { FreeCamera } from '@babylonjs/core/Cameras/freeCamera';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { ShadowGenerator } from '@babylonjs/core/Lights/Shadows/shadowGenerator';
import '@babylonjs/core/Lights/Shadows/shadowGeneratorSceneComponent';

export interface SceneContext {
  scene: Scene;
  camera: FreeCamera;
  sunLight: DirectionalLight;
  ambientLight: HemisphericLight;
  shadowGenerator: ShadowGenerator;
}

/**
 * Creates and configures the main game scene
 */
export function createScene(engine: Engine): SceneContext {
  const scene = new Scene(engine);
  scene.autoClear = false;
  scene.autoAnimate = false;

  // Set background color - warm sunset sky
  scene.clearColor = new Color4(0.95, 0.6, 0.3, 1.0);

  // Atmospheric fog - golden sunset haze
  scene.fogMode = Scene.FOGMODE_EXP2;
  scene.fogDensity = 0.00035;
  scene.fogColor = new Color3(0.85, 0.65, 0.45); // Warm golden haze

  // Ambient light - VERY low so sun is the dominant light source
  // This creates realistic shadows - areas not hit by sun are dark
  const ambientLight = new HemisphericLight(
    'ambientLight',
    new Vector3(0, 1, 0),
    scene
  );
  ambientLight.intensity = 0.25;  // Low - sun should be primary
  ambientLight.diffuse = new Color3(0.7, 0.75, 0.9);  // Subtle sky fill
  ambientLight.groundColor = new Color3(0.15, 0.12, 0.18); // Dark shadow areas

  // Sun - the primary and dominant light source
  const sunLight = new DirectionalLight(
    'sunLight',
    new Vector3(-0.8, -0.3, -0.5).normalize(),
    scene
  );
  sunLight.intensity = 1.2;  // Bright - this IS the light
  sunLight.diffuse = new Color3(1.0, 0.85, 0.6);
  sunLight.specular = new Color3(1.0, 0.9, 0.7);
  sunLight.position = new Vector3(500, 150, 300);

  // Shadow generator - dominant visual feature, buildings cast real shadows
  const shadowGenerator = new ShadowGenerator(2048, sunLight);
  shadowGenerator.useBlurExponentialShadowMap = true;
  shadowGenerator.blurKernel = 32;
  shadowGenerator.setDarkness(0.65);  // Dark shadows - sun is primary light
  shadowGenerator.bias = 0.001;
  shadowGenerator.normalBias = 0.02;
  shadowGenerator.freezeShadowCastersBoundingInfo = true;

  // Create main camera (will be controlled by CameraController)
  const camera = new FreeCamera('mainCamera', new Vector3(0, 10, -20), scene);
  camera.minZ = 0.5;
  camera.maxZ = 4000; // See the whole city from high altitude
  camera.fov = 1.0;

  // Create procedural sky gradient
  createSkyGradient(scene);

  // Note: Ground is created by City.ts, not here (avoids z-fighting)

  return {
    scene,
    camera,
    sunLight,
    ambientLight,
    shadowGenerator,
  };
}

/**
 * Creates the sky dome and sun/glow meshes.
 * DayNightCycle controls their colors and positions over time.
 */
function createSkyGradient(scene: Scene): void {
  // Sky dome
  const skybox = MeshBuilder.CreateSphere(
    'skyDome',
    { diameter: 3500, segments: 12 },
    scene
  );
  skybox.infiniteDistance = true;
  const skyMaterial = new StandardMaterial('skyMaterial', scene);
  skyMaterial.backFaceCulling = false;
  skyMaterial.disableLighting = true;
  skyMaterial.emissiveColor = new Color3(0.3, 0.45, 0.75);
  skybox.material = skyMaterial;
  skybox.isPickable = false;

  // Sun disc - MASSIVE, sits right on the horizon
  const sun = MeshBuilder.CreateSphere(
    'sunDisc',
    { diameter: 400, segments: 16 },
    scene
  );
  sun.infiniteDistance = true;
  const sunMat = new StandardMaterial('sunMat', scene);
  sunMat.disableLighting = true;
  sunMat.emissiveColor = new Color3(1.0, 0.85, 0.4);
  sun.material = sunMat;
  sun.isPickable = false;
  // Initial position - DayNightCycle will update this
  sun.position = new Vector3(1500, 50, -500);

  // Sun glow halo - huge soft glow around the sun
  const sunGlow = MeshBuilder.CreateSphere(
    'sunGlow',
    { diameter: 900, segments: 8 },
    scene
  );
  sunGlow.infiniteDistance = true;
  const glowMat = new StandardMaterial('sunGlowMat', scene);
  glowMat.disableLighting = true;
  glowMat.emissiveColor = new Color3(1.0, 0.7, 0.3);
  glowMat.alpha = 0.12;
  sunGlow.material = glowMat;
  sunGlow.isPickable = false;
  sunGlow.position = sun.position.clone();
}
