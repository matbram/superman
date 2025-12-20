/**
 * Atmospheric effects - Volumetric clouds, sun, and sky system
 */

import { Scene } from '@babylonjs/core/scene';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { GlowLayer } from '@babylonjs/core/Layers/glowLayer';

// Atmosphere constants
const SUN_DISTANCE = 800;
const CLOUD_HEIGHT_MIN = 120;
const CLOUD_HEIGHT_MAX = 350;
const CLOUD_RENDER_DISTANCE = 700;
const NUM_CLOUD_CLUSTERS = 50;

/**
 * Individual cloud puff with its own properties
 */
interface CloudPuff {
  mesh: Mesh;
  localOffset: Vector3;
  phase: number;
  bobSpeed: number;
  bobAmount: number;
}

/**
 * Cloud cluster data
 */
interface CloudCluster {
  puffs: CloudPuff[];
  basePosition: Vector3;
  driftSpeed: Vector3;
  rotationSpeed: number;
  rotation: number;
}

/**
 * Atmosphere system with sun, clouds, and sky gradient
 */
export class Atmosphere {
  private scene: Scene;
  private sunMesh: Mesh | null = null;
  private sunGlow: Mesh | null = null;
  private glowLayer: GlowLayer | null = null;
  private cloudClusters: CloudCluster[] = [];
  private cloudMaterials: StandardMaterial[] = [];
  private skyDome: Mesh | null = null;
  private time: number = 0;

  constructor(scene: Scene) {
    this.scene = scene;

    this.createGlowLayer();
    this.createSkyDome();
    this.createSun();
    this.createCloudMaterials();
    this.generateInitialClouds();
  }

  /**
   * Creates glow layer for sun and effects
   */
  private createGlowLayer(): void {
    this.glowLayer = new GlowLayer('glowLayer', this.scene);
    this.glowLayer.intensity = 0.8;
  }

  /**
   * Creates enhanced sky dome with gradient
   */
  private createSkyDome(): void {
    this.skyDome = MeshBuilder.CreateSphere(
      'atmosphereDome',
      { diameter: 2800, segments: 32 },
      this.scene
    );
    this.skyDome.infiniteDistance = true;
    this.skyDome.isPickable = false;

    const skyMaterial = new StandardMaterial('atmosphereMaterial', this.scene);
    skyMaterial.backFaceCulling = false;
    skyMaterial.disableLighting = true;
    skyMaterial.emissiveColor = new Color3(0.45, 0.65, 0.95);
    skyMaterial.freeze();

    this.skyDome.material = skyMaterial;
  }

  /**
   * Creates the sun with glow effect
   */
  private createSun(): void {
    this.sunMesh = MeshBuilder.CreateSphere(
      'sun',
      { diameter: 60, segments: 16 },
      this.scene
    );
    this.sunMesh.position = new Vector3(
      SUN_DISTANCE * 0.7,
      SUN_DISTANCE * 0.8,
      SUN_DISTANCE * 0.3
    );
    this.sunMesh.isPickable = false;

    const sunMaterial = new StandardMaterial('sunMaterial', this.scene);
    sunMaterial.emissiveColor = new Color3(1.0, 0.95, 0.8);
    sunMaterial.disableLighting = true;
    sunMaterial.freeze();
    this.sunMesh.material = sunMaterial;

    if (this.glowLayer) {
      this.glowLayer.addIncludedOnlyMesh(this.sunMesh);
    }

    this.sunGlow = MeshBuilder.CreateSphere(
      'sunGlow',
      { diameter: 120, segments: 16 },
      this.scene
    );
    this.sunGlow.position = this.sunMesh.position.clone();
    this.sunGlow.isPickable = false;

    const glowMaterial = new StandardMaterial('sunGlowMaterial', this.scene);
    glowMaterial.emissiveColor = new Color3(1.0, 0.9, 0.6);
    glowMaterial.disableLighting = true;
    glowMaterial.alpha = 0.3;
    glowMaterial.freeze();
    this.sunGlow.material = glowMaterial;

    if (this.glowLayer) {
      this.glowLayer.addIncludedOnlyMesh(this.sunGlow);
    }
  }

  /**
   * Creates multiple cloud materials with varying opacity for depth/volume
   */
  private createCloudMaterials(): void {
    // Core cloud material - bright and more opaque
    const coreMat = new StandardMaterial('cloudCore', this.scene);
    coreMat.diffuseColor = new Color3(1, 1, 1);
    coreMat.emissiveColor = new Color3(0.95, 0.95, 0.98);
    coreMat.specularColor = new Color3(0, 0, 0);
    coreMat.alpha = 0.9;
    coreMat.backFaceCulling = false;
    coreMat.freeze();
    this.cloudMaterials.push(coreMat);

    // Mid-layer - slightly less opaque
    const midMat = new StandardMaterial('cloudMid', this.scene);
    midMat.diffuseColor = new Color3(0.98, 0.98, 1);
    midMat.emissiveColor = new Color3(0.88, 0.9, 0.95);
    midMat.specularColor = new Color3(0, 0, 0);
    midMat.alpha = 0.7;
    midMat.backFaceCulling = false;
    midMat.freeze();
    this.cloudMaterials.push(midMat);

    // Wispy outer layer - more transparent
    const wispyMat = new StandardMaterial('cloudWispy', this.scene);
    wispyMat.diffuseColor = new Color3(0.95, 0.95, 1);
    wispyMat.emissiveColor = new Color3(0.8, 0.85, 0.92);
    wispyMat.specularColor = new Color3(0, 0, 0);
    wispyMat.alpha = 0.45;
    wispyMat.backFaceCulling = false;
    wispyMat.freeze();
    this.cloudMaterials.push(wispyMat);

    // Smoky edge layer - very transparent
    const smokeyMat = new StandardMaterial('cloudSmokey', this.scene);
    smokeyMat.diffuseColor = new Color3(0.92, 0.94, 1);
    smokeyMat.emissiveColor = new Color3(0.75, 0.8, 0.88);
    smokeyMat.specularColor = new Color3(0, 0, 0);
    smokeyMat.alpha = 0.25;
    smokeyMat.backFaceCulling = false;
    smokeyMat.freeze();
    this.cloudMaterials.push(smokeyMat);

    // Shadow/underside material - darker
    const shadowMat = new StandardMaterial('cloudShadow', this.scene);
    shadowMat.diffuseColor = new Color3(0.7, 0.75, 0.85);
    shadowMat.emissiveColor = new Color3(0.5, 0.55, 0.65);
    shadowMat.specularColor = new Color3(0, 0, 0);
    shadowMat.alpha = 0.6;
    shadowMat.backFaceCulling = false;
    shadowMat.freeze();
    this.cloudMaterials.push(shadowMat);
  }

  /**
   * Generates initial cloud clusters around origin
   */
  private generateInitialClouds(): void {
    for (let i = 0; i < NUM_CLOUD_CLUSTERS; i++) {
      const angle = (i / NUM_CLOUD_CLUSTERS) * Math.PI * 2;
      const radius = 80 + Math.random() * (CLOUD_RENDER_DISTANCE - 80);

      const x = Math.cos(angle) * radius;
      const z = Math.sin(angle) * radius;
      const y = CLOUD_HEIGHT_MIN + Math.random() * (CLOUD_HEIGHT_MAX - CLOUD_HEIGHT_MIN);

      this.createCloudCluster(new Vector3(x, y, z));
    }
  }

  /**
   * Creates a realistic volumetric cloud cluster with layered puffs
   */
  private createCloudCluster(position: Vector3): CloudCluster {
    const puffs: CloudPuff[] = [];

    // Determine cloud size category
    const cloudSize = 0.7 + Math.random() * 0.8; // 0.7 to 1.5 scale multiplier
    const isLargeCloud = cloudSize > 1.1;

    // Core puffs - dense center
    const numCorePuffs = isLargeCloud ? 5 + Math.floor(Math.random() * 4) : 3 + Math.floor(Math.random() * 3);
    for (let i = 0; i < numCorePuffs; i++) {
      const scaleX = (20 + Math.random() * 30) * cloudSize;
      const scaleY = (12 + Math.random() * 18) * cloudSize;
      const scaleZ = (20 + Math.random() * 30) * cloudSize;

      const puff = MeshBuilder.CreateSphere(
        `cloud_core_${this.cloudClusters.length}_${i}`,
        { diameter: 1, segments: 6 },
        this.scene
      );

      const offsetX = (Math.random() - 0.5) * 30 * cloudSize;
      const offsetY = (Math.random() - 0.3) * 8 * cloudSize; // Slightly higher
      const offsetZ = (Math.random() - 0.5) * 30 * cloudSize;

      puff.position = position.add(new Vector3(offsetX, offsetY, offsetZ));
      puff.scaling = new Vector3(scaleX, scaleY, scaleZ);
      puff.material = this.cloudMaterials[0]; // Core material
      puff.isPickable = false;
      puff.receiveShadows = false;

      puffs.push({
        mesh: puff,
        localOffset: new Vector3(offsetX, offsetY, offsetZ),
        phase: Math.random() * Math.PI * 2,
        bobSpeed: 0.2 + Math.random() * 0.3,
        bobAmount: 1 + Math.random() * 2,
      });
    }

    // Mid-layer puffs - surrounding the core
    const numMidPuffs = isLargeCloud ? 6 + Math.floor(Math.random() * 4) : 4 + Math.floor(Math.random() * 3);
    for (let i = 0; i < numMidPuffs; i++) {
      const scaleX = (25 + Math.random() * 35) * cloudSize;
      const scaleY = (10 + Math.random() * 15) * cloudSize;
      const scaleZ = (25 + Math.random() * 35) * cloudSize;

      const puff = MeshBuilder.CreateSphere(
        `cloud_mid_${this.cloudClusters.length}_${i}`,
        { diameter: 1, segments: 6 },
        this.scene
      );

      const offsetX = (Math.random() - 0.5) * 60 * cloudSize;
      const offsetY = (Math.random() - 0.5) * 12 * cloudSize;
      const offsetZ = (Math.random() - 0.5) * 60 * cloudSize;

      puff.position = position.add(new Vector3(offsetX, offsetY, offsetZ));
      puff.scaling = new Vector3(scaleX, scaleY, scaleZ);
      puff.material = this.cloudMaterials[1]; // Mid material
      puff.isPickable = false;
      puff.receiveShadows = false;

      puffs.push({
        mesh: puff,
        localOffset: new Vector3(offsetX, offsetY, offsetZ),
        phase: Math.random() * Math.PI * 2,
        bobSpeed: 0.15 + Math.random() * 0.25,
        bobAmount: 1.5 + Math.random() * 2.5,
      });
    }

    // Wispy outer puffs - ethereal edges
    const numWispyPuffs = isLargeCloud ? 8 + Math.floor(Math.random() * 5) : 5 + Math.floor(Math.random() * 4);
    for (let i = 0; i < numWispyPuffs; i++) {
      const scaleX = (30 + Math.random() * 50) * cloudSize;
      const scaleY = (6 + Math.random() * 12) * cloudSize;
      const scaleZ = (30 + Math.random() * 50) * cloudSize;

      const puff = MeshBuilder.CreateSphere(
        `cloud_wispy_${this.cloudClusters.length}_${i}`,
        { diameter: 1, segments: 5 },
        this.scene
      );

      const offsetX = (Math.random() - 0.5) * 90 * cloudSize;
      const offsetY = (Math.random() - 0.5) * 15 * cloudSize;
      const offsetZ = (Math.random() - 0.5) * 90 * cloudSize;

      puff.position = position.add(new Vector3(offsetX, offsetY, offsetZ));
      puff.scaling = new Vector3(scaleX, scaleY, scaleZ);
      puff.material = this.cloudMaterials[2]; // Wispy material
      puff.isPickable = false;
      puff.receiveShadows = false;

      puffs.push({
        mesh: puff,
        localOffset: new Vector3(offsetX, offsetY, offsetZ),
        phase: Math.random() * Math.PI * 2,
        bobSpeed: 0.1 + Math.random() * 0.2,
        bobAmount: 2 + Math.random() * 3,
      });
    }

    // Smoky tendrils - very wispy edges
    const numSmokyPuffs = isLargeCloud ? 6 + Math.floor(Math.random() * 4) : 3 + Math.floor(Math.random() * 3);
    for (let i = 0; i < numSmokyPuffs; i++) {
      const scaleX = (40 + Math.random() * 60) * cloudSize;
      const scaleY = (4 + Math.random() * 8) * cloudSize;
      const scaleZ = (40 + Math.random() * 60) * cloudSize;

      const puff = MeshBuilder.CreateSphere(
        `cloud_smoky_${this.cloudClusters.length}_${i}`,
        { diameter: 1, segments: 4 },
        this.scene
      );

      const offsetX = (Math.random() - 0.5) * 120 * cloudSize;
      const offsetY = (Math.random() - 0.6) * 20 * cloudSize; // Tend toward bottom
      const offsetZ = (Math.random() - 0.5) * 120 * cloudSize;

      puff.position = position.add(new Vector3(offsetX, offsetY, offsetZ));
      puff.scaling = new Vector3(scaleX, scaleY, scaleZ);
      puff.material = this.cloudMaterials[3]; // Smoky material
      puff.isPickable = false;
      puff.receiveShadows = false;

      puffs.push({
        mesh: puff,
        localOffset: new Vector3(offsetX, offsetY, offsetZ),
        phase: Math.random() * Math.PI * 2,
        bobSpeed: 0.08 + Math.random() * 0.15,
        bobAmount: 3 + Math.random() * 4,
      });
    }

    // Shadow puffs on underside
    const numShadowPuffs = isLargeCloud ? 3 + Math.floor(Math.random() * 2) : 2;
    for (let i = 0; i < numShadowPuffs; i++) {
      const scaleX = (35 + Math.random() * 40) * cloudSize;
      const scaleY = (8 + Math.random() * 10) * cloudSize;
      const scaleZ = (35 + Math.random() * 40) * cloudSize;

      const puff = MeshBuilder.CreateSphere(
        `cloud_shadow_${this.cloudClusters.length}_${i}`,
        { diameter: 1, segments: 5 },
        this.scene
      );

      const offsetX = (Math.random() - 0.5) * 50 * cloudSize;
      const offsetY = -10 - Math.random() * 15 * cloudSize; // Below center
      const offsetZ = (Math.random() - 0.5) * 50 * cloudSize;

      puff.position = position.add(new Vector3(offsetX, offsetY, offsetZ));
      puff.scaling = new Vector3(scaleX, scaleY, scaleZ);
      puff.material = this.cloudMaterials[4]; // Shadow material
      puff.isPickable = false;
      puff.receiveShadows = false;

      puffs.push({
        mesh: puff,
        localOffset: new Vector3(offsetX, offsetY, offsetZ),
        phase: Math.random() * Math.PI * 2,
        bobSpeed: 0.12 + Math.random() * 0.18,
        bobAmount: 1 + Math.random() * 2,
      });
    }

    const cluster: CloudCluster = {
      puffs,
      basePosition: position.clone(),
      driftSpeed: new Vector3(
        (Math.random() - 0.5) * 3,
        0,
        (Math.random() - 0.5) * 3
      ),
      rotationSpeed: (Math.random() - 0.5) * 0.02,
      rotation: Math.random() * Math.PI * 2,
    };

    this.cloudClusters.push(cluster);
    return cluster;
  }

  /**
   * Updates cloud positions and manages cloud streaming
   */
  public update(playerPosition: Vector3, deltaTime: number): void {
    this.time += deltaTime;

    // Update sun position relative to player
    if (this.sunMesh && this.sunGlow) {
      const sunOffset = new Vector3(
        SUN_DISTANCE * 0.7,
        SUN_DISTANCE * 0.8,
        SUN_DISTANCE * 0.3
      );
      this.sunMesh.position = playerPosition.add(sunOffset);
      this.sunGlow.position = this.sunMesh.position.clone();
    }

    // Update cloud clusters
    for (const cluster of this.cloudClusters) {
      // Drift clouds slowly
      cluster.basePosition.addInPlace(cluster.driftSpeed.scale(deltaTime));
      cluster.rotation += cluster.rotationSpeed * deltaTime;

      // Update each puff with organic movement
      for (const puff of cluster.puffs) {
        // Calculate rotated offset for slow cloud rotation
        const cos = Math.cos(cluster.rotation);
        const sin = Math.sin(cluster.rotation);
        const rotatedX = puff.localOffset.x * cos - puff.localOffset.z * sin;
        const rotatedZ = puff.localOffset.x * sin + puff.localOffset.z * cos;

        // Organic bobbing motion
        const bobY = Math.sin(this.time * puff.bobSpeed + puff.phase) * puff.bobAmount;
        const bobX = Math.sin(this.time * puff.bobSpeed * 0.7 + puff.phase + 1) * puff.bobAmount * 0.3;
        const bobZ = Math.cos(this.time * puff.bobSpeed * 0.5 + puff.phase) * puff.bobAmount * 0.3;

        puff.mesh.position.x = cluster.basePosition.x + rotatedX + bobX;
        puff.mesh.position.y = cluster.basePosition.y + puff.localOffset.y + bobY;
        puff.mesh.position.z = cluster.basePosition.z + rotatedZ + bobZ;

        // Subtle scale pulsing for "breathing" effect
        const scalePulse = 1 + Math.sin(this.time * 0.5 + puff.phase) * 0.03;
        puff.mesh.scaling.x *= scalePulse;
        puff.mesh.scaling.z *= scalePulse;
      }

      // Check if cluster is too far from player
      const dx = cluster.basePosition.x - playerPosition.x;
      const dz = cluster.basePosition.z - playerPosition.z;
      const distSq = dx * dx + dz * dz;

      if (distSq > CLOUD_RENDER_DISTANCE * CLOUD_RENDER_DISTANCE * 1.5) {
        // Respawn cluster on opposite side of player
        const angle = Math.atan2(dz, dx) + Math.PI;
        const newRadius = CLOUD_RENDER_DISTANCE * 0.9;
        cluster.basePosition.x = playerPosition.x + Math.cos(angle) * newRadius;
        cluster.basePosition.z = playerPosition.z + Math.sin(angle) * newRadius;
        cluster.basePosition.y = CLOUD_HEIGHT_MIN + Math.random() * (CLOUD_HEIGHT_MAX - CLOUD_HEIGHT_MIN);

        // Reset puff positions
        for (const puff of cluster.puffs) {
          puff.mesh.position = cluster.basePosition.add(puff.localOffset);
        }
      }
    }
  }

  /**
   * Cleans up atmosphere resources
   */
  public dispose(): void {
    for (const cluster of this.cloudClusters) {
      for (const puff of cluster.puffs) {
        puff.mesh.dispose();
      }
    }
    this.cloudClusters = [];

    this.sunMesh?.dispose();
    this.sunGlow?.dispose();
    this.skyDome?.dispose();
    this.glowLayer?.dispose();
    for (const mat of this.cloudMaterials) {
      mat.dispose();
    }
  }
}
