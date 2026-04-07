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

  // Set background color (sky blue gradient effect)
  scene.clearColor = new Color4(0.4, 0.6, 0.9, 1.0);

  // Atmospheric fog - gives depth and haze to the city skyline
  scene.fogMode = Scene.FOGMODE_EXP2;
  scene.fogDensity = 0.0004; // Subtle haze, visible at distance but not close
  scene.fogColor = new Color3(0.65, 0.75, 0.92); // Blue-gray atmospheric haze

  // Create ambient light (hemisphere light)
  const ambientLight = new HemisphericLight(
    'ambientLight',
    new Vector3(0, 1, 0),
    scene
  );
  ambientLight.intensity = 0.6;
  ambientLight.groundColor = new Color3(0.4, 0.4, 0.5);

  // Create directional sun light for shadows
  const sunLight = new DirectionalLight(
    'sunLight',
    new Vector3(-0.5, -1, -0.5).normalize(),
    scene
  );
  sunLight.intensity = 0.7;
  sunLight.position = new Vector3(100, 200, 100);

  // Create shadow generator - optimized settings
  const shadowGenerator = new ShadowGenerator(512, sunLight);
  shadowGenerator.useBlurExponentialShadowMap = true;
  shadowGenerator.blurKernel = 8;
  shadowGenerator.setDarkness(0.4);

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
 * Creates a gradient sky effect using a large skybox
 */
function createSkyGradient(scene: Scene): void {
  const skybox = MeshBuilder.CreateSphere(
    'skyDome',
    { diameter: 3000, segments: 8 },
    scene
  );
  skybox.infiniteDistance = true;

  const skyMaterial = new StandardMaterial('skyMaterial', scene);
  skyMaterial.backFaceCulling = false;
  skyMaterial.disableLighting = true;
  skyMaterial.emissiveColor = new Color3(0.5, 0.7, 1.0);

  skybox.material = skyMaterial;
  skybox.isPickable = false;
}
