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
const CLOUD_RENDER_DISTANCE = 600;
const NUM_CLOUD_CLUSTERS = 18; // Reduced for performance

// Cloud dispersion constants
const CLOUD_DISPERSE_RADIUS = 35;
const CLOUD_DISPERSE_SPEED = 100;
const CLOUD_RECOVER_SPEED = 10;
const CLOUD_SCATTER_VARIANCE = 0.5;

/**
 * Individual cloud puff with its own properties
 */
interface CloudPuff {
  mesh: Mesh;
  localOffset: Vector3;
  phase: number;
  bobSpeed: number;
  bobAmount: number;
  // Dispersion state
  disperseOffset: Vector3;
  disperseScale: number;
  originalScale: Vector3;
  scatterDirection: Vector3;
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
      { diameter: 2800, segments: 8 },
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
   * Creates a volumetric cloud cluster - optimized for performance
   */
  private createCloudCluster(position: Vector3): CloudCluster {
    const puffs: CloudPuff[] = [];
    const cloudSize = 0.8 + Math.random() * 0.6;

    // Core puffs only - 3-4 large spheres (reduced from 25+)
    const numPuffs = 3 + Math.floor(Math.random() * 2);
    for (let i = 0; i < numPuffs; i++) {
      const scaleX = (25 + Math.random() * 35) * cloudSize;
      const scaleY = (15 + Math.random() * 20) * cloudSize;
      const scaleZ = (25 + Math.random() * 35) * cloudSize;

      const puff = MeshBuilder.CreateSphere(
        `cloud_${this.cloudClusters.length}_${i}`,
        { diameter: 1, segments: 4 }, // Low poly
        this.scene
      );

      const offsetX = (Math.random() - 0.5) * 50 * cloudSize;
      const offsetY = (Math.random() - 0.5) * 12 * cloudSize;
      const offsetZ = (Math.random() - 0.5) * 50 * cloudSize;

      puff.position = position.add(new Vector3(offsetX, offsetY, offsetZ));
      puff.scaling = new Vector3(scaleX, scaleY, scaleZ);
      // Alternate between materials for variety
      puff.material = this.cloudMaterials[i % 3];
      puff.isPickable = false;
      puff.receiveShadows = false;

      puffs.push({
        mesh: puff,
        localOffset: new Vector3(offsetX, offsetY, offsetZ),
        phase: Math.random() * Math.PI * 2,
        bobSpeed: 0.15 + Math.random() * 0.2,
        bobAmount: 1.5 + Math.random() * 2,
        disperseOffset: Vector3.Zero(),
        disperseScale: 1,
        originalScale: new Vector3(scaleX, scaleY, scaleZ),
        scatterDirection: new Vector3(
          (Math.random() - 0.5) * 2,
          (Math.random() - 0.3),
          (Math.random() - 0.5) * 2
        ).normalize(),
      });
    }

    // Add 1-2 wispy outer puffs
    const numWispy = 1 + Math.floor(Math.random() * 2);
    for (let i = 0; i < numWispy; i++) {
      const scaleX = (40 + Math.random() * 50) * cloudSize;
      const scaleY = (8 + Math.random() * 12) * cloudSize;
      const scaleZ = (40 + Math.random() * 50) * cloudSize;

      const puff = MeshBuilder.CreateSphere(
        `cloud_wispy_${this.cloudClusters.length}_${i}`,
        { diameter: 1, segments: 4 },
        this.scene
      );

      const offsetX = (Math.random() - 0.5) * 80 * cloudSize;
      const offsetY = (Math.random() - 0.6) * 15 * cloudSize;
      const offsetZ = (Math.random() - 0.5) * 80 * cloudSize;

      puff.position = position.add(new Vector3(offsetX, offsetY, offsetZ));
      puff.scaling = new Vector3(scaleX, scaleY, scaleZ);
      puff.material = this.cloudMaterials[3]; // Smoky/wispy material
      puff.isPickable = false;
      puff.receiveShadows = false;

      puffs.push({
        mesh: puff,
        localOffset: new Vector3(offsetX, offsetY, offsetZ),
        phase: Math.random() * Math.PI * 2,
        bobSpeed: 0.1 + Math.random() * 0.15,
        bobAmount: 2 + Math.random() * 3,
        disperseOffset: Vector3.Zero(),
        disperseScale: 1,
        originalScale: new Vector3(scaleX, scaleY, scaleZ),
        scatterDirection: new Vector3(
          (Math.random() - 0.5) * 2,
          (Math.random() - 0.3),
          (Math.random() - 0.5) * 2
        ).normalize(),
      });
    }

    const cluster: CloudCluster = {
      puffs,
      basePosition: position.clone(),
      driftSpeed: new Vector3(
        (Math.random() - 0.5) * 2,
        0,
        (Math.random() - 0.5) * 2
      ),
      rotationSpeed: (Math.random() - 0.5) * 0.01,
      rotation: Math.random() * Math.PI * 2,
    };

    this.cloudClusters.push(cluster);
    return cluster;
  }

  // Pre-computed constants
  private static readonly SUN_OFFSET_X = SUN_DISTANCE * 0.7;
  private static readonly SUN_OFFSET_Y = SUN_DISTANCE * 0.8;
  private static readonly SUN_OFFSET_Z = SUN_DISTANCE * 0.3;
  private static readonly DISPERSE_RADIUS_SQ = CLOUD_DISPERSE_RADIUS * CLOUD_DISPERSE_RADIUS;
  private static readonly CLOUD_UNLOAD_DIST_SQ = CLOUD_RENDER_DISTANCE * CLOUD_RENDER_DISTANCE * 1.5;

  /**
   * Updates cloud positions and manages cloud streaming
   */
  public update(playerPosition: Vector3, deltaTime: number, _playerVelocity?: Vector3, playerSpeed?: number): void {
    this.time += deltaTime;

    // Update sun position relative to player - no allocations
    if (this.sunMesh && this.sunGlow) {
      this.sunMesh.position.x = playerPosition.x + Atmosphere.SUN_OFFSET_X;
      this.sunMesh.position.y = playerPosition.y + Atmosphere.SUN_OFFSET_Y;
      this.sunMesh.position.z = playerPosition.z + Atmosphere.SUN_OFFSET_Z;
      this.sunGlow.position.copyFrom(this.sunMesh.position);
    }

    const speed = playerSpeed ?? 0;
    const canDisperse = speed > 30;

    // Update cloud clusters
    for (const cluster of this.cloudClusters) {
      // Drift clouds slowly - inline to avoid scale() allocation
      cluster.basePosition.x += cluster.driftSpeed.x * deltaTime;
      cluster.basePosition.y += cluster.driftSpeed.y * deltaTime;
      cluster.basePosition.z += cluster.driftSpeed.z * deltaTime;

      // Update each puff with bobbing and dispersion
      for (const puff of cluster.puffs) {
        const bobY = Math.sin(this.time * puff.bobSpeed + puff.phase) * puff.bobAmount;

        const baseX = cluster.basePosition.x + puff.localOffset.x;
        const baseY = cluster.basePosition.y + puff.localOffset.y + bobY;
        const baseZ = cluster.basePosition.z + puff.localOffset.z;

        // Use squared distance to avoid sqrt unless needed for dispersion
        const dx = baseX - playerPosition.x;
        const dy = baseY - playerPosition.y;
        const dz = baseZ - playerPosition.z;
        const distSq = dx * dx + dy * dy + dz * dz;

        if (canDisperse && distSq < Atmosphere.DISPERSE_RADIUS_SQ) {
          const dist = Math.sqrt(distSq);
          const disperseStrength = (1 - dist / CLOUD_DISPERSE_RADIUS) * (speed / 100);

          const pushX = dx + puff.scatterDirection.x * CLOUD_SCATTER_VARIANCE;
          const pushY = dy + puff.scatterDirection.y * CLOUD_SCATTER_VARIANCE;
          const pushZ = dz + puff.scatterDirection.z * CLOUD_SCATTER_VARIANCE;
          const pushLenSq = pushX * pushX + pushY * pushY + pushZ * pushZ;
          const pushLen = pushLenSq > 0.001 ? Math.sqrt(pushLenSq) : 1;

          const force = CLOUD_DISPERSE_SPEED * disperseStrength * deltaTime;
          const invLen = force / pushLen;
          puff.disperseOffset.x += pushX * invLen;
          puff.disperseOffset.y += pushY * invLen;
          puff.disperseOffset.z += pushZ * invLen;

          puff.disperseScale = Math.max(0.3, puff.disperseScale - disperseStrength * deltaTime);
        } else {
          const recover = CLOUD_RECOVER_SPEED * deltaTime * 0.05;
          const decay = 1 - recover;
          puff.disperseOffset.x *= decay;
          puff.disperseOffset.y *= decay;
          puff.disperseOffset.z *= decay;
          puff.disperseScale = Math.min(1, puff.disperseScale + recover * 0.5);
        }

        // Limit max offset - use squared distance to skip sqrt when possible
        const oLenSq = puff.disperseOffset.x * puff.disperseOffset.x
          + puff.disperseOffset.y * puff.disperseOffset.y
          + puff.disperseOffset.z * puff.disperseOffset.z;
        if (oLenSq > 2500) { // 50^2
          const scale = 50 / Math.sqrt(oLenSq);
          puff.disperseOffset.x *= scale;
          puff.disperseOffset.y *= scale;
          puff.disperseOffset.z *= scale;
        }

        // Apply position with dispersion offset
        puff.mesh.position.x = baseX + puff.disperseOffset.x;
        puff.mesh.position.y = baseY + puff.disperseOffset.y;
        puff.mesh.position.z = baseZ + puff.disperseOffset.z;

        // Apply scale with dispersion
        const ds = puff.disperseScale;
        puff.mesh.scaling.x = puff.originalScale.x * ds;
        puff.mesh.scaling.y = puff.originalScale.y * ds;
        puff.mesh.scaling.z = puff.originalScale.z * ds;
      }

      // Check if cluster is too far from player
      const cdx = cluster.basePosition.x - playerPosition.x;
      const cdz = cluster.basePosition.z - playerPosition.z;
      const cDistSq = cdx * cdx + cdz * cdz;

      if (cDistSq > Atmosphere.CLOUD_UNLOAD_DIST_SQ) {
        const angle = Math.atan2(cdz, cdx) + Math.PI;
        const newRadius = CLOUD_RENDER_DISTANCE * 0.9;
        cluster.basePosition.x = playerPosition.x + Math.cos(angle) * newRadius;
        cluster.basePosition.z = playerPosition.z + Math.sin(angle) * newRadius;
        cluster.basePosition.y = CLOUD_HEIGHT_MIN + Math.random() * (CLOUD_HEIGHT_MAX - CLOUD_HEIGHT_MIN);

        for (const puff of cluster.puffs) {
          puff.mesh.position.x = cluster.basePosition.x + puff.localOffset.x;
          puff.mesh.position.y = cluster.basePosition.y + puff.localOffset.y;
          puff.mesh.position.z = cluster.basePosition.z + puff.localOffset.z;
          puff.disperseOffset.setAll(0);
          puff.disperseScale = 1;
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
