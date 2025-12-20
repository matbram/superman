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
// CubeTexture available for future skybox implementation
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

  // Set background color (sky blue gradient effect)
  scene.clearColor = new Color4(0.4, 0.6, 0.9, 1.0);

  // Enable fog for depth perception and speed sensation
  scene.fogMode = Scene.FOGMODE_EXP2;
  scene.fogDensity = 0.001;
  scene.fogColor = new Color3(0.6, 0.7, 0.9);

  // Create ambient light (hemisphere light)
  const ambientLight = new HemisphericLight(
    'ambientLight',
    new Vector3(0, 1, 0),
    scene
  );
  ambientLight.intensity = 0.5;
  ambientLight.groundColor = new Color3(0.3, 0.3, 0.4);

  // Create directional sun light for shadows
  const sunLight = new DirectionalLight(
    'sunLight',
    new Vector3(-0.5, -1, -0.5).normalize(),
    scene
  );
  sunLight.intensity = 0.8;
  sunLight.position = new Vector3(100, 200, 100);

  // Create shadow generator
  const shadowGenerator = new ShadowGenerator(2048, sunLight);
  shadowGenerator.useBlurExponentialShadowMap = true;
  shadowGenerator.blurKernel = 32;
  shadowGenerator.setDarkness(0.3);

  // Create main camera (will be controlled by CameraController)
  const camera = new FreeCamera('mainCamera', new Vector3(0, 10, -20), scene);
  camera.minZ = 0.1;
  camera.maxZ = 2000;
  camera.fov = 1.0; // ~57 degrees, will be dynamically adjusted for speed

  // Create procedural sky gradient
  createSkyGradient(scene);

  // Create ground plane (base layer)
  createBaseGround(scene, shadowGenerator);

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
  // Create a large sphere for the sky
  const skybox = MeshBuilder.CreateSphere(
    'skyDome',
    { diameter: 3000, segments: 16 },
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

/**
 * Creates the base ground plane with road-like appearance
 */
function createBaseGround(scene: Scene, _shadowGenerator: ShadowGenerator): void {
  const ground = MeshBuilder.CreateGround(
    'baseGround',
    { width: 1000, height: 1000 },
    scene
  );
  ground.position.y = 0;

  const groundMaterial = new StandardMaterial('groundMaterial', scene);
  groundMaterial.diffuseColor = new Color3(0.2, 0.2, 0.2);
  groundMaterial.specularColor = new Color3(0.1, 0.1, 0.1);

  ground.material = groundMaterial;
  ground.receiveShadows = true;
  ground.isPickable = false;
  ground.checkCollisions = true;
}
