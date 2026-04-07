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

  // Ambient light - warm golden hour tones
  const ambientLight = new HemisphericLight(
    'ambientLight',
    new Vector3(0, 1, 0),
    scene
  );
  ambientLight.intensity = 0.5;
  ambientLight.diffuse = new Color3(1.0, 0.85, 0.7);       // Warm top light
  ambientLight.groundColor = new Color3(0.3, 0.25, 0.35);  // Cool shadow fill

  // Sun - low angle for dramatic long shadows (golden hour / sunset)
  const sunLight = new DirectionalLight(
    'sunLight',
    new Vector3(-0.8, -0.3, -0.5).normalize(), // Low angle sun
    scene
  );
  sunLight.intensity = 1.0;
  sunLight.diffuse = new Color3(1.0, 0.8, 0.5);  // Warm golden sunlight
  sunLight.specular = new Color3(1.0, 0.9, 0.7);
  sunLight.position = new Vector3(500, 150, 300);

  // Shadow generator - larger map for better quality at distance
  const shadowGenerator = new ShadowGenerator(1024, sunLight);
  shadowGenerator.useBlurExponentialShadowMap = true;
  shadowGenerator.blurKernel = 16;
  shadowGenerator.setDarkness(0.5);
  shadowGenerator.bias = 0.001;
  shadowGenerator.normalBias = 0.02;
  // Freeze shadow map when not actively changing (huge perf win)
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
    shadowGenerator,
  };
}

/**
 * Creates a sunset sky with gradient and visible sun disc
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
  // Upper sky: deep blue fading to warm horizon
  skyMaterial.emissiveColor = new Color3(0.3, 0.45, 0.75);
  skybox.material = skyMaterial;
  skybox.isPickable = false;

  // Horizon glow band (warm orange ring at the horizon)
  const horizonBand = MeshBuilder.CreateTorus(
    'horizonGlow',
    { diameter: 3400, thickness: 200, tessellation: 24 },
    scene
  );
  horizonBand.infiniteDistance = true;
  horizonBand.rotation.x = Math.PI / 2;
  const horizonMat = new StandardMaterial('horizonMat', scene);
  horizonMat.backFaceCulling = false;
  horizonMat.disableLighting = true;
  horizonMat.emissiveColor = new Color3(1.0, 0.6, 0.25);
  horizonMat.alpha = 0.4;
  horizonBand.material = horizonMat;
  horizonBand.isPickable = false;

  // Sun disc - big, warm, low on the horizon
  const sun = MeshBuilder.CreateSphere(
    'sunDisc',
    { diameter: 120, segments: 16 },
    scene
  );
  // Position the sun at the horizon in the direction the sunlight comes FROM
  sun.position = new Vector3(800, 150, 500);
  sun.infiniteDistance = true;
  const sunMat = new StandardMaterial('sunMat', scene);
  sunMat.disableLighting = true;
  sunMat.emissiveColor = new Color3(1.0, 0.85, 0.4);  // Warm golden sun
  sun.material = sunMat;
  sun.isPickable = false;

  // Sun glow (larger, softer halo around the sun)
  const sunGlow = MeshBuilder.CreateSphere(
    'sunGlow',
    { diameter: 350, segments: 8 },
    scene
  );
  sunGlow.position = sun.position.clone();
  sunGlow.infiniteDistance = true;
  const glowMat = new StandardMaterial('sunGlowMat', scene);
  glowMat.disableLighting = true;
  glowMat.emissiveColor = new Color3(1.0, 0.7, 0.3);
  glowMat.alpha = 0.15;
  sunGlow.material = glowMat;
  sunGlow.isPickable = false;
}
