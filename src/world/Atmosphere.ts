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
const CLOUD_HEIGHT_MIN = 150;
const CLOUD_HEIGHT_MAX = 300;
const CLOUD_RENDER_DISTANCE = 600;
const NUM_CLOUD_CLUSTERS = 40;

/**
 * Cloud cluster data
 */
interface CloudCluster {
  meshes: Mesh[];
  basePosition: Vector3;
  driftSpeed: Vector3;
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
  private cloudMaterial: StandardMaterial | null = null;
  private skyDome: Mesh | null = null;
  private time: number = 0;

  constructor(scene: Scene) {
    this.scene = scene;

    this.createGlowLayer();
    this.createSkyDome();
    this.createSun();
    this.createCloudMaterial();
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
    // Sky blue gradient - slightly deeper blue at top
    skyMaterial.emissiveColor = new Color3(0.45, 0.65, 0.95);
    skyMaterial.freeze();

    this.skyDome.material = skyMaterial;
  }

  /**
   * Creates the sun with glow effect
   */
  private createSun(): void {
    // Main sun disk
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

    // Add sun to glow layer
    if (this.glowLayer) {
      this.glowLayer.addIncludedOnlyMesh(this.sunMesh);
    }

    // Sun corona/glow effect (larger semi-transparent sphere)
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
   * Creates shared material for clouds
   */
  private createCloudMaterial(): void {
    this.cloudMaterial = new StandardMaterial('cloudMaterial', this.scene);
    this.cloudMaterial.diffuseColor = new Color3(1, 1, 1);
    this.cloudMaterial.emissiveColor = new Color3(0.9, 0.92, 0.95);
    this.cloudMaterial.specularColor = new Color3(0, 0, 0);
    this.cloudMaterial.alpha = 0.85;
    this.cloudMaterial.backFaceCulling = false;
    this.cloudMaterial.freeze();
  }

  /**
   * Generates initial cloud clusters around origin
   */
  private generateInitialClouds(): void {
    for (let i = 0; i < NUM_CLOUD_CLUSTERS; i++) {
      const angle = (i / NUM_CLOUD_CLUSTERS) * Math.PI * 2;
      const radius = 100 + Math.random() * (CLOUD_RENDER_DISTANCE - 100);

      const x = Math.cos(angle) * radius;
      const z = Math.sin(angle) * radius;
      const y = CLOUD_HEIGHT_MIN + Math.random() * (CLOUD_HEIGHT_MAX - CLOUD_HEIGHT_MIN);

      this.createCloudCluster(new Vector3(x, y, z));
    }
  }

  /**
   * Creates a volumetric cloud cluster using multiple overlapping ellipsoids
   */
  private createCloudCluster(position: Vector3): CloudCluster {
    const meshes: Mesh[] = [];
    const numPuffs = 4 + Math.floor(Math.random() * 5);

    for (let i = 0; i < numPuffs; i++) {
      // Create ellipsoid cloud puff
      const scaleX = 15 + Math.random() * 25;
      const scaleY = 8 + Math.random() * 12;
      const scaleZ = 15 + Math.random() * 25;

      const puff = MeshBuilder.CreateSphere(
        `cloud_${this.cloudClusters.length}_${i}`,
        { diameter: 1, segments: 8 },
        this.scene
      );

      // Random offset within cluster
      const offsetX = (Math.random() - 0.5) * 40;
      const offsetY = (Math.random() - 0.5) * 10;
      const offsetZ = (Math.random() - 0.5) * 40;

      puff.position = position.add(new Vector3(offsetX, offsetY, offsetZ));
      puff.scaling = new Vector3(scaleX, scaleY, scaleZ);
      puff.material = this.cloudMaterial;
      puff.isPickable = false;
      puff.receiveShadows = false;

      meshes.push(puff);
    }

    const cluster: CloudCluster = {
      meshes,
      basePosition: position.clone(),
      driftSpeed: new Vector3(
        (Math.random() - 0.5) * 2,
        0,
        (Math.random() - 0.5) * 2
      ),
    };

    this.cloudClusters.push(cluster);
    return cluster;
  }

  /**
   * Updates cloud positions and manages cloud streaming
   */
  public update(playerPosition: Vector3, deltaTime: number): void {
    this.time += deltaTime;

    // Update sun position relative to player (keeps sun in consistent position)
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

      // Update mesh positions with subtle bobbing
      for (let i = 0; i < cluster.meshes.length; i++) {
        const mesh = cluster.meshes[i];
        const bobOffset = Math.sin(this.time * 0.3 + i) * 0.5;
        mesh.position.y = cluster.basePosition.y + bobOffset + (Math.sin(this.time * 0.2 + i * 0.5) * 2);
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

        // Update all mesh positions
        for (const mesh of cluster.meshes) {
          const offsetX = (Math.random() - 0.5) * 40;
          const offsetY = (Math.random() - 0.5) * 10;
          const offsetZ = (Math.random() - 0.5) * 40;
          mesh.position = cluster.basePosition.add(new Vector3(offsetX, offsetY, offsetZ));
        }
      }
    }
  }

  /**
   * Cleans up atmosphere resources
   */
  public dispose(): void {
    for (const cluster of this.cloudClusters) {
      for (const mesh of cluster.meshes) {
        mesh.dispose();
      }
    }
    this.cloudClusters = [];

    this.sunMesh?.dispose();
    this.sunGlow?.dispose();
    this.skyDome?.dispose();
    this.glowLayer?.dispose();
    this.cloudMaterial?.dispose();
  }
}
