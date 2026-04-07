/**
 * PedestrianSystem - Voxel pedestrians walking on sidewalks.
 *
 * All pedestrians rendered as thin instances of shared source meshes.
 * Bodies = colored boxes, heads = skin-tone boxes.
 * ~5 draw calls total for ALL pedestrians.
 */

import { Scene } from '@babylonjs/core/scene';
import { Vector3, Matrix, Color3 } from '@babylonjs/core/Maths/math';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import '@babylonjs/core/Meshes/thinInstanceMesh';

const MAX_PEDESTRIANS = 180;
const WALK_SPEED = 1.5;
const SPAWN_RADIUS = 200;
const DESPAWN_RADIUS = 280;
const SPAWN_INTERVAL = 0.08;  // Spawn faster for crowded sidewalks

// Street grid (match City.ts)
const CHUNK_SIZE = 200;
const AVENUE_WIDTH = 40;
const BLOCK_WIDTH = 70;

interface Pedestrian {
  x: number;
  z: number;
  dirX: number;
  dirZ: number;
  speed: number;
  colorIndex: number;
  knocked: boolean;
}

export class PedestrianSystem {
  private scene: Scene;
  private pedestrians: Pedestrian[] = [];
  private spawnTimer = 0;

  // Source meshes - bodies in different colors + heads
  private bodyMeshes: Mesh[] = [];
  private headMesh: Mesh;
  private bodyBuffers: Float32Array[] = [];
  private headBuffer: Float32Array;

  constructor(scene: Scene) {
    this.scene = scene;

    // Body colors (clothing)
    const bodyColors = [
      new Color3(0.15, 0.15, 0.5),   // Dark blue
      new Color3(0.5, 0.12, 0.12),   // Dark red
      new Color3(0.2, 0.2, 0.2),     // Dark gray
      new Color3(0.4, 0.35, 0.15),   // Khaki
    ];

    for (const color of bodyColors) {
      const body = MeshBuilder.CreateBox('pedBody', {
        width: 0.8, height: 2.2, depth: 0.6
      }, scene);
      const mat = new StandardMaterial('pedBodyMat', scene);
      mat.diffuseColor = color;
      mat.freeze();
      body.material = mat;
      body.isPickable = false;
      body.thinInstanceSetBuffer('matrix', new Float32Array(0), 16);
      this.bodyMeshes.push(body);
      this.bodyBuffers.push(new Float32Array(MAX_PEDESTRIANS * 16));
    }

    // Head (skin tone)
    this.headMesh = MeshBuilder.CreateBox('pedHead', {
      width: 0.6, height: 0.7, depth: 0.6
    }, scene);
    const headMat = new StandardMaterial('pedHeadMat', scene);
    headMat.diffuseColor = new Color3(0.85, 0.7, 0.55);
    headMat.freeze();
    this.headMesh.material = headMat;
    this.headMesh.isPickable = false;
    this.headMesh.thinInstanceSetBuffer('matrix', new Float32Array(0), 16);
    this.headBuffer = new Float32Array(MAX_PEDESTRIANS * 16);
  }

  public update(deltaTime: number, playerPos: Vector3, playerSpeed: number = 0, playerVelocity?: Vector3): void {
    // Spawn
    this.spawnTimer += deltaTime;
    if (this.spawnTimer >= SPAWN_INTERVAL && this.pedestrians.length < MAX_PEDESTRIANS) {
      this.spawnTimer = 0;
      this.trySpawn(playerPos);
    }

    // Move + knockback + despawn
    for (let i = this.pedestrians.length - 1; i >= 0; i--) {
      const p = this.pedestrians[i];

      // Superman knockback - nearby pedestrians get blown away
      const dx = p.x - playerPos.x, dz = p.z - playerPos.z;
      const distSq = dx * dx + dz * dz;
      const knockRadius = 8 + playerSpeed * 0.05; // Bigger radius at higher speed

      if (distSq < knockRadius * knockRadius && playerSpeed > 15) {
        const dist = Math.sqrt(distSq) || 1;
        const force = Math.min(30, playerSpeed * 0.3);
        // Knocked in the direction away from Superman + Superman's velocity
        p.dirX = (dx / dist) * 0.7 + (playerVelocity ? playerVelocity.x * 0.01 : 0);
        p.dirZ = (dz / dist) * 0.7 + (playerVelocity ? playerVelocity.z * 0.01 : 0);
        p.speed = force;
        p.knocked = true;
      }

      // Knocked pedestrians slow down
      if (p.knocked) {
        p.speed *= (1 - deltaTime * 3);
        if (p.speed < 0.5) {
          // Remove knocked pedestrians after they stop
          this.pedestrians.splice(i, 1);
          continue;
        }
      }

      p.x += p.dirX * p.speed * deltaTime;
      p.z += p.dirZ * p.speed * deltaTime;

      if (distSq > DESPAWN_RADIUS * DESPAWN_RADIUS) {
        this.pedestrians.splice(i, 1);
      }
    }

    // Update thin instance buffers
    this.updateBuffers();
  }

  private trySpawn(playerPos: Vector3): void {
    const angle = Math.random() * Math.PI * 2;
    const dist = 30 + Math.random() * (SPAWN_RADIUS - 30);
    const rawX = playerPos.x + Math.cos(angle) * dist;
    const rawZ = playerPos.z + Math.sin(angle) * dist;

    // Snap to SIDEWALK using chunk-aligned avenue positions
    const avenueSpacing = BLOCK_WIDTH + AVENUE_WIDTH;
    const chunkOriginX = Math.floor(rawX / 200) * 200; // CHUNK_SIZE = 200
    const localX = rawX - chunkOriginX;
    const avenueIndex = Math.round((localX - AVENUE_WIDTH * 0.5) / avenueSpacing);
    const avenueCenter = chunkOriginX + AVENUE_WIDTH * 0.5 + avenueIndex * avenueSpacing;

    // Place on sidewalk: AVENUE_WIDTH/2 + 2 to + 8 (on the 12-unit raised sidewalk)
    const side = Math.random() > 0.5 ? -1 : 1;
    const sidewalkOffset = AVENUE_WIDTH * 0.5 + 2 + Math.random() * 6;
    const x = avenueCenter + side * sidewalkOffset;
    const z = rawZ;

    // Pedestrians walk ALONG sidewalks (parallel to avenue)
    const dirX = 0;
    const dirZ = Math.random() > 0.5 ? 1 : -1;

    this.pedestrians.push({
      x, z,
      dirX, dirZ,
      speed: WALK_SPEED * (0.7 + Math.random() * 0.6),
      colorIndex: Math.floor(Math.random() * this.bodyMeshes.length),
      knocked: false,
    });
  }

  private updateBuffers(): void {
    // Count per color
    const counts = new Array(this.bodyMeshes.length).fill(0);
    let headCount = 0;

    for (const p of this.pedestrians) {
      const ci = p.colorIndex;
      const bodyOff = counts[ci] * 16;
      const headOff = headCount * 16;

      // Body matrix (at waist height)
      this.setTranslation(this.bodyBuffers[ci], bodyOff, p.x, 1.3, p.z);
      counts[ci]++;

      // Head matrix (above body)
      this.setTranslation(this.headBuffer, headOff, p.x, 2.75, p.z);
      headCount++;
    }

    // Upload buffers
    for (let i = 0; i < this.bodyMeshes.length; i++) {
      this.bodyMeshes[i].thinInstanceSetBuffer(
        'matrix',
        counts[i] > 0 ? this.bodyBuffers[i].subarray(0, counts[i] * 16) : new Float32Array(0),
        16, false
      );
    }
    this.headMesh.thinInstanceSetBuffer(
      'matrix',
      headCount > 0 ? this.headBuffer.subarray(0, headCount * 16) : new Float32Array(0),
      16, false
    );
  }

  private setTranslation(buffer: Float32Array, offset: number, x: number, y: number, z: number): void {
    // Identity matrix with translation
    buffer[offset] = 1; buffer[offset + 1] = 0; buffer[offset + 2] = 0; buffer[offset + 3] = 0;
    buffer[offset + 4] = 0; buffer[offset + 5] = 1; buffer[offset + 6] = 0; buffer[offset + 7] = 0;
    buffer[offset + 8] = 0; buffer[offset + 9] = 0; buffer[offset + 10] = 1; buffer[offset + 11] = 0;
    buffer[offset + 12] = x; buffer[offset + 13] = y; buffer[offset + 14] = z; buffer[offset + 15] = 1;
  }

  /**
   * Kill pedestrians near a point (heat vision, explosions, etc.)
   */
  public killNear(position: Vector3, radius: number): number {
    let killed = 0;
    for (let i = this.pedestrians.length - 1; i >= 0; i--) {
      const p = this.pedestrians[i];
      const dx = p.x - position.x, dz = p.z - position.z;
      if (dx * dx + dz * dz < radius * radius) {
        this.pedestrians.splice(i, 1);
        killed++;
      }
    }
    return killed;
  }

  public dispose(): void {
    for (const m of this.bodyMeshes) m.dispose();
    this.headMesh.dispose();
  }
}
