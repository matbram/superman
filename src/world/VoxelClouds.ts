/**
 * VoxelClouds - Volumetric voxel clouds that part when things fly through them.
 *
 * Each cloud is a cluster of small white/gray cubes. When Superman or the UFO
 * passes through, the cubes get pushed outward with physics, then slowly drift
 * back to reform the cloud.
 *
 * ALL cloud voxels rendered as thin instances of ONE source mesh (1 draw call).
 */

import { Scene } from '@babylonjs/core/scene';
import { Vector3, Matrix, Color3 } from '@babylonjs/core/Maths/math';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import '@babylonjs/core/Meshes/thinInstanceMesh';

const CLOUD_HEIGHT_MIN = 400;
const CLOUD_HEIGHT_MAX = 550;
const NUM_CLOUDS = 20;
const VOXELS_PER_CLOUD = 60;   // More voxels per cloud for density
const VOXEL_SIZE = 4;          // Smaller cubes look more cloud-like
const DISPERSE_RADIUS = 50;    // How close before voxels part
const DISPERSE_FORCE = 120;    // How fast voxels fly apart
const RECOVER_SPEED = 5;       // How fast voxels drift back (slower = floatier)
const CLOUD_SPREAD = 800;      // How far clouds extend from origin

interface CloudVoxel {
  // Home position (where it wants to be)
  homeX: number;
  homeY: number;
  homeZ: number;
  // Current offset from home (dispersion)
  offsetX: number;
  offsetY: number;
  offsetZ: number;
  // Velocity (for physics-based dispersion)
  velX: number;
  velY: number;
  velZ: number;
  // Visual variation
  scale: number;
}

export class VoxelClouds {
  private scene: Scene;
  private cloudMesh: Mesh;
  private voxels: CloudVoxel[] = [];
  private matrices: Float32Array;

  constructor(scene: Scene) {
    this.scene = scene;

    // Source mesh: single white cube, all clouds are thin instances
    this.cloudMesh = MeshBuilder.CreateBox('cloudVoxelSrc', {
      size: VOXEL_SIZE,
    }, scene);

    const mat = new StandardMaterial('cloudVoxelMat', scene);
    mat.diffuseColor = new Color3(0.92, 0.93, 0.97);
    mat.emissiveColor = new Color3(0.35, 0.38, 0.45); // Subtle - not blinding white
    mat.specularColor = new Color3(0, 0, 0);
    mat.alpha = 0.35; // More transparent - clouds are wispy
    mat.backFaceCulling = false;
    mat.freeze();
    this.cloudMesh.material = mat;
    this.cloudMesh.isPickable = false;

    // Generate cloud clusters
    for (let c = 0; c < NUM_CLOUDS; c++) {
      const cx = (Math.random() - 0.5) * CLOUD_SPREAD * 2;
      const cy = CLOUD_HEIGHT_MIN + Math.random() * (CLOUD_HEIGHT_MAX - CLOUD_HEIGHT_MIN);
      const cz = (Math.random() - 0.5) * CLOUD_SPREAD * 2;

      // Clouds are WIDE and FLAT (like real cumulus clouds)
      const cloudWidth = 80 + Math.random() * 120;
      const cloudDepth = 60 + Math.random() * 100;
      const cloudHeight = 8 + Math.random() * 12; // Very flat

      for (let v = 0; v < VOXELS_PER_CLOUD; v++) {
        this.voxels.push({
          homeX: cx + (Math.random() - 0.5) * cloudWidth,
          homeY: cy + (Math.random() - 0.5) * cloudHeight,
          homeZ: cz + (Math.random() - 0.5) * cloudDepth,
          offsetX: 0, offsetY: 0, offsetZ: 0,
          velX: 0, velY: 0, velZ: 0,
          // Vary scale: wider than tall for puffy look
          scale: 0.5 + Math.random() * 1.0,
        });
      }
    }

    this.matrices = new Float32Array(this.voxels.length * 16);
    this.updateMatrices();
  }

  /**
   * Update cloud positions. Pass in positions of objects that should
   * part the clouds (Superman, UFO, etc.)
   */
  public update(deltaTime: number, dispersers: Vector3[]): void {
    for (const voxel of this.voxels) {
      // Current world position
      const wx = voxel.homeX + voxel.offsetX;
      const wy = voxel.homeY + voxel.offsetY;
      const wz = voxel.homeZ + voxel.offsetZ;

      // Check each disperser (Superman, UFO, etc.)
      let dispersed = false;
      for (const pos of dispersers) {
        const dx = wx - pos.x;
        const dy = wy - pos.y;
        const dz = wz - pos.z;
        const distSq = dx * dx + dy * dy + dz * dz;

        if (distSq < DISPERSE_RADIUS * DISPERSE_RADIUS) {
          const dist = Math.sqrt(distSq) || 1;
          const force = DISPERSE_FORCE * (1 - dist / DISPERSE_RADIUS);

          // Push voxel away from the disperser
          voxel.velX += (dx / dist) * force * deltaTime;
          voxel.velY += (dy / dist) * force * deltaTime;
          voxel.velZ += (dz / dist) * force * deltaTime;
          dispersed = true;
        }
      }

      // Apply velocity to offset
      voxel.offsetX += voxel.velX * deltaTime;
      voxel.offsetY += voxel.velY * deltaTime;
      voxel.offsetZ += voxel.velZ * deltaTime;

      // Dampen velocity
      const damping = dispersed ? 0.95 : 0.9;
      voxel.velX *= damping;
      voxel.velY *= damping;
      voxel.velZ *= damping;

      // Recover toward home position (spring force)
      voxel.offsetX -= voxel.offsetX * RECOVER_SPEED * deltaTime;
      voxel.offsetY -= voxel.offsetY * RECOVER_SPEED * deltaTime;
      voxel.offsetZ -= voxel.offsetZ * RECOVER_SPEED * deltaTime;
    }

    this.updateMatrices();
  }

  /**
   * Reposition clouds around a new center (follows player)
   */
  public recenter(center: Vector3): void {
    for (const voxel of this.voxels) {
      // If a voxel's home is too far from center, wrap it
      if (Math.abs(voxel.homeX - center.x) > CLOUD_SPREAD) {
        voxel.homeX = center.x + (Math.random() - 0.5) * CLOUD_SPREAD * 2;
        voxel.offsetX = 0; voxel.velX = 0;
      }
      if (Math.abs(voxel.homeZ - center.z) > CLOUD_SPREAD) {
        voxel.homeZ = center.z + (Math.random() - 0.5) * CLOUD_SPREAD * 2;
        voxel.offsetZ = 0; voxel.velZ = 0;
      }
    }
  }

  private updateMatrices(): void {
    for (let i = 0; i < this.voxels.length; i++) {
      const v = this.voxels[i];
      const x = v.homeX + v.offsetX;
      const y = v.homeY + v.offsetY;
      const z = v.homeZ + v.offsetZ;
      const s = v.scale;
      const off = i * 16;

      // Scale + translate matrix
      this.matrices[off] = s;     this.matrices[off + 1] = 0;
      this.matrices[off + 2] = 0; this.matrices[off + 3] = 0;
      this.matrices[off + 4] = 0; this.matrices[off + 5] = s;
      this.matrices[off + 6] = 0; this.matrices[off + 7] = 0;
      this.matrices[off + 8] = 0; this.matrices[off + 9] = 0;
      this.matrices[off + 10] = s; this.matrices[off + 11] = 0;
      this.matrices[off + 12] = x; this.matrices[off + 13] = y;
      this.matrices[off + 14] = z; this.matrices[off + 15] = 1;
    }

    this.cloudMesh.thinInstanceSetBuffer('matrix', this.matrices, 16, false);
  }

  public dispose(): void {
    this.cloudMesh.dispose();
  }
}
