/**
 * VoxelWorld - Central coordinator for all voxelized buildings.
 *
 * Replaces BuildingDamage.ts with a cleaner architecture:
 * - Spatial hash for O(1) building lookup by position
 * - Grid-based collision (no Babylon.js raycasting for buildings)
 * - Single applyDamage() entry point
 * - Lifecycle management (cleanup, auto-destroy)
 * - Debris and dust effects
 */

import { Scene } from '@babylonjs/core/scene';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { ParticleSystem } from '@babylonjs/core/Particles/particleSystem';
import { VoxelBuilding, VoxelRayHit, VOXEL_SIZE } from './VoxelBuilding';
import { PhysicsManager } from '../physics/physics';
import { Diag } from '../core/DiagnosticLog';
import type { GravityZone } from './AlienShip';

// ── Constants ──────────────────────────────────────────────────────────
const MAX_DEBRIS = 120;
const DEBRIS_SETTLE_TIME = 12000;
const DEBRIS_CLEANUP_DIST = 120;
const VOXEL_CLEANUP_DIST = 350;
const AUTO_DESTROY_THRESHOLD = 0.08;
const DAMAGE_COOLDOWN = 60;
const GRAVITY = -30;
const MAX_DUST = 20;

// ── Interfaces ─────────────────────────────────────────────────────────
interface DebrisPiece {
  mesh: Mesh;
  velocity: Vector3;
  angularVelocity: Vector3;
  isChunk: boolean;
  settled: boolean;
  settleTime: number;
}

interface DustCloud {
  particles: ParticleSystem;
  lifetime: number;
}

export interface CollisionResult {
  hit: boolean;
  building: VoxelBuilding | null;
  point: Vector3;
  normal: Vector3;
  distance: number;
  gridX: number;
  gridY: number;
  gridZ: number;
}

const NO_COLLISION: CollisionResult = {
  hit: false, building: null, point: Vector3.Zero(),
  normal: Vector3.Up(), distance: Infinity, gridX: -1, gridY: -1, gridZ: -1,
};

// ── VoxelWorld ─────────────────────────────────────────────────────────
export class VoxelWorld {
  private scene: Scene;
  private physicsManager: PhysicsManager | null;

  // All voxelized buildings, keyed by first original mesh
  private buildings: Map<Mesh, VoxelBuilding> = new Map();
  // All meshes (including siblings) → VoxelBuilding
  private meshToBuilding: Map<Mesh, VoxelBuilding> = new Map();
  // Flat list for spatial queries
  private buildingList: VoxelBuilding[] = [];

  // Per-mesh damage cooldown
  private damageCooldowns: Map<Mesh, number> = new Map();

  // Effects
  private debris: DebrisPiece[] = [];
  private dustClouds: DustCloud[] = [];
  private debrisMaterials: StandardMaterial[] = [];

  // Gravity zone
  private gravityZone: GravityZone | null = null;
  private getGravityAtPosition: ((pos: Vector3) => number) | null = null;

  constructor(scene: Scene, physicsManager?: PhysicsManager) {
    this.scene = scene;
    this.physicsManager = physicsManager || null;
    this.createDebrisMaterials();
  }

  // ── Setup ──────────────────────────────────────────────────────────

  public setGravityZone(zone: GravityZone, fn: (pos: Vector3) => number): void {
    this.gravityZone = zone;
    this.getGravityAtPosition = fn;
  }

  private createDebrisMaterials(): void {
    const colors = [
      new Color3(0.5, 0.5, 0.55), new Color3(0.35, 0.35, 0.4),
      new Color3(0.45, 0.42, 0.4), new Color3(0.55, 0.52, 0.5),
    ];
    for (let i = 0; i < colors.length; i++) {
      const mat = new StandardMaterial(`debrisMat_${i}`, this.scene);
      mat.diffuseColor = colors[i];
      mat.specularColor = new Color3(0.1, 0.1, 0.1);
      mat.freeze();
      this.debrisMaterials.push(mat);
    }
  }

  // ── Query ──────────────────────────────────────────────────────────

  public isVoxelized(mesh: Mesh): boolean {
    return this.meshToBuilding.has(mesh);
  }

  public getVoxelBuilding(mesh: Mesh): VoxelBuilding | null {
    return this.meshToBuilding.get(mesh) || null;
  }

  // ── Voxelization ──────────────────────────────────────────────────

  /**
   * Convert a building mesh (and all its sibling parts) into a VoxelBuilding.
   * Finds all meshes with the same building_{chunk}_{index} prefix and merges them.
   */
  public voxelizeBuilding(mesh: Mesh): VoxelBuilding {
    // Already voxelized?
    const existing = this.meshToBuilding.get(mesh);
    if (existing) return existing;

    // Find sibling meshes (same building prefix)
    const prefix = this.getBuildingPrefix(mesh.name);
    const siblings = this.findSiblingMeshes(mesh, prefix);

    const material = (mesh.material as StandardMaterial) || this.debrisMaterials[0];
    const vb = new VoxelBuilding(this.scene, siblings, material);

    Diag.log('Voxelize', `${prefix} → ${vb.gridWidth}x${vb.gridHeight}x${vb.gridDepth} (${siblings.length} meshes)`);

    // Hide all original meshes
    for (const m of siblings) {
      m.isVisible = false;
      this.meshToBuilding.set(m, vb);
    }

    this.buildings.set(siblings[0], vb);
    this.buildingList.push(vb);

    return vb;
  }

  private getBuildingPrefix(name: string): string {
    // building_-1,2_5_main → building_-1,2_5_
    // Trailing underscore prevents index 1 from matching 10, 11, etc.
    const parts = name.split('_');
    if (parts.length >= 4) return parts.slice(0, 3).join('_') + '_';
    return name + '_';
  }

  private findSiblingMeshes(mesh: Mesh, prefix: string): Mesh[] {
    const siblings: Mesh[] = [];
    for (const m of this.scene.meshes) {
      if (m.name.startsWith(prefix) && !m.isDisposed() && !this.meshToBuilding.has(m as Mesh)) {
        siblings.push(m as Mesh);
      }
    }
    if (siblings.length === 0) siblings.push(mesh);
    return siblings;
  }

  // ── Grid-Based Collision ───────────────────────────────────────────

  /**
   * Raycast through ALL voxelized buildings. Returns closest hit.
   * This replaces scene.pickWithRay for building collision.
   */
  public collideRay(origin: Vector3, direction: Vector3, maxDist: number): CollisionResult {
    let closest: CollisionResult = NO_COLLISION;

    for (const vb of this.buildingList) {
      const hit = vb.raycast(origin, direction, maxDist);
      if (hit.hit && hit.distance < closest.distance) {
        closest = {
          hit: true,
          building: vb,
          point: hit.point,
          normal: hit.normal,
          distance: hit.distance,
          gridX: hit.gridX,
          gridY: hit.gridY,
          gridZ: hit.gridZ,
        };
      }
    }

    return closest;
  }

  /**
   * Check if any solid voxel block exists at this world position.
   */
  public isSolidAt(point: Vector3): boolean {
    for (const vb of this.buildingList) {
      if (vb.containsPoint(point) && vb.isSolidAtWorld(point)) {
        return true;
      }
    }
    return false;
  }

  // ── Damage ─────────────────────────────────────────────────────────

  /**
   * Single damage entry point. All damage sources call this.
   */
  public applyDamage(mesh: Mesh, position: Vector3, speed: number): void {
    const now = performance.now();
    const lastHit = this.damageCooldowns.get(mesh) || 0;
    if (now - lastHit < DAMAGE_COOLDOWN) return;
    this.damageCooldowns.set(mesh, now);

    Diag.count('Damage', 'hits');

    let vb = this.meshToBuilding.get(mesh);

    if (!vb) {
      // Small decorative meshes - just destroy
      const bounds = mesh.getBoundingInfo().boundingBox;
      const height = bounds.maximumWorld.y - bounds.minimumWorld.y;
      if (height < 5) {
        mesh.isVisible = false;
        mesh.isPickable = false;
        if (this.physicsManager) this.physicsManager.removeCollisionMesh(mesh);
        this.spawnDebrisAt(position, speed, 3);
        this.spawnDust(position, 3, 0.5);
        return;
      }
      vb = this.voxelizeBuilding(mesh);
    }

    // Remove blocks at impact
    // Cap radius to half the thinnest wall so we don't blow through both sides
    const minDim = Math.min(vb.worldWidth, vb.worldDepth);
    const maxRadius = minDim * 0.4; // Never remove more than 40% of building width
    const punchRadius = Math.min(3 + Math.min(6, speed / 20), maxRadius);
    const removed = vb.removeBlocksInRadius(position, punchRadius);

    if (removed.length > 0) {
      Diag.track('Damage', 'blocksRemoved', removed.length);
      this.spawnDebrisFromPositions(removed, position, speed);
      this.spawnDust(position, 5, 1);

      // Structural cascade - disconnected blocks fall
      const disconnected = vb.findDisconnectedBlocks();
      if (disconnected.length > 0) {
        const fallingPositions: Vector3[] = [];
        for (const { x, y, z } of disconnected) {
          const pos = vb.removeBlock(x, y, z);
          if (pos) fallingPositions.push(pos);
        }
        vb.flushChanges();
        this.spawnFallingDebris(fallingPositions);
        if (fallingPositions.length > 3) {
          this.spawnDust(fallingPositions[Math.floor(fallingPositions.length / 2)], 4, 1);
        }
      }
    }

    // Auto-destroy nearly empty buildings
    if (vb.getPercentRemaining() < AUTO_DESTROY_THRESHOLD) {
      this.destroyBuilding(vb);
    }

    Diag.track('Damage', 'activeDebris', this.debris.length);
    Diag.track('Damage', 'voxelBuildings', this.buildingList.length);
  }

  /**
   * Apply damage at a specific grid position (used by physics DDA hit).
   */
  public applyDamageAtGrid(vb: VoxelBuilding, gridX: number, gridY: number, gridZ: number, speed: number): void {
    const worldPos = vb.gridToWorldPos(gridX, gridY, gridZ);
    const minDim = Math.min(vb.worldWidth, vb.worldDepth);
    const maxRadius = minDim * 0.4;
    const punchRadius = Math.min(3 + Math.min(6, speed / 20), maxRadius);
    const removed = vb.removeBlocksInRadius(worldPos, punchRadius);

    if (removed.length > 0) {
      Diag.track('Damage', 'blocksRemoved', removed.length);
      this.spawnDebrisFromPositions(removed, worldPos, speed);
      this.spawnDust(worldPos, 5, 1);

      const disconnected = vb.findDisconnectedBlocks();
      if (disconnected.length > 0) {
        const falling: Vector3[] = [];
        for (const { x, y, z } of disconnected) {
          const pos = vb.removeBlock(x, y, z);
          if (pos) falling.push(pos);
        }
        vb.flushChanges();
        this.spawnFallingDebris(falling);
      }
    }

    if (vb.getPercentRemaining() < AUTO_DESTROY_THRESHOLD) {
      this.destroyBuilding(vb);
    }
  }

  // ── Building Lifecycle ─────────────────────────────────────────────

  private destroyBuilding(vb: VoxelBuilding): void {
    vb.dispose();

    // Remove from all maps
    for (const mesh of vb.originalMeshes) {
      this.meshToBuilding.delete(mesh);
      this.buildings.delete(mesh);
      this.damageCooldowns.delete(mesh);
      // Remove from physics and scene
      mesh.isPickable = false;
      if (this.physicsManager) this.physicsManager.removeCollisionMesh(mesh);
      mesh.dispose();
    }

    const idx = this.buildingList.indexOf(vb);
    if (idx !== -1) this.buildingList.splice(idx, 1);

    Diag.count('Damage', 'buildingsDestroyed');
  }

  public cleanupChunk(chunkKey: string): void {
    for (const [mesh, vb] of this.buildings) {
      if (mesh.name.includes(chunkKey)) {
        this.destroyBuilding(vb);
      }
    }
  }

  // ── Debris ─────────────────────────────────────────────────────────

  private spawnDebrisFromPositions(positions: Vector3[], impactPos: Vector3, speed: number): void {
    const count = Math.min(positions.length, MAX_DEBRIS - this.debris.length, 8);
    for (let i = 0; i < count; i++) {
      const pos = positions[i];
      const dx = pos.x - impactPos.x, dz = pos.z - impactPos.z;
      const len = Math.sqrt(dx * dx + dz * dz) || 1;
      const push = Math.min(speed * 0.1, 10);
      const size = 0.8 + Math.random() * 2;

      const m = MeshBuilder.CreateBox(`rbl_${this.debris.length}`, {
        width: size * (0.4 + Math.random() * 0.8),
        height: size * (0.3 + Math.random() * 0.5),
        depth: size * (0.4 + Math.random() * 0.8),
      }, this.scene);
      m.position.copyFrom(pos);
      m.material = this.debrisMaterials[Math.floor(Math.random() * this.debrisMaterials.length)];
      m.isPickable = false;

      this.debris.push({
        mesh: m,
        velocity: new Vector3((dx / len) * push + (Math.random() - 0.5) * 4, 1 + Math.random() * 4, (dz / len) * push + (Math.random() - 0.5) * 4),
        angularVelocity: new Vector3((Math.random() - 0.5) * 4, (Math.random() - 0.5) * 2, (Math.random() - 0.5) * 4),
        isChunk: true, settled: false, settleTime: 0,
      });
    }
  }

  private spawnFallingDebris(positions: Vector3[]): void {
    const count = Math.min(positions.length, MAX_DEBRIS - this.debris.length, 6);
    for (let i = 0; i < count; i++) {
      const size = 0.8 + Math.random() * 2;
      const m = MeshBuilder.CreateBox(`fall_${this.debris.length}`, {
        width: size * 0.6, height: size * 0.4, depth: size * 0.6
      }, this.scene);
      m.position.copyFrom(positions[i]);
      m.material = this.debrisMaterials[Math.floor(Math.random() * this.debrisMaterials.length)];
      m.isPickable = false;
      this.debris.push({
        mesh: m,
        velocity: new Vector3((Math.random() - 0.5) * 3, -2 - Math.random() * 3, (Math.random() - 0.5) * 3),
        angularVelocity: new Vector3((Math.random() - 0.5) * 3, (Math.random() - 0.5) * 2, (Math.random() - 0.5) * 3),
        isChunk: true, settled: false, settleTime: 0,
      });
    }
  }

  private spawnDebrisAt(pos: Vector3, speed: number, count: number): void {
    const actual = Math.min(count, MAX_DEBRIS - this.debris.length);
    for (let i = 0; i < actual; i++) {
      const size = 0.3 + Math.random() * 1.2;
      const m = MeshBuilder.CreateBox(`d_${this.debris.length}`, {
        width: size * 0.5, height: size * 0.5, depth: size * 0.5
      }, this.scene);
      m.position.set(pos.x + (Math.random() - 0.5) * 4, pos.y + (Math.random() - 0.5) * 4, pos.z + (Math.random() - 0.5) * 4);
      m.material = this.debrisMaterials[Math.floor(Math.random() * this.debrisMaterials.length)];
      m.isPickable = false;
      this.debris.push({
        mesh: m,
        velocity: new Vector3((Math.random() - 0.5) * speed * 0.3, Math.random() * speed * 0.2 + 5, (Math.random() - 0.5) * speed * 0.3),
        angularVelocity: new Vector3((Math.random() - 0.5) * 8, (Math.random() - 0.5) * 8, (Math.random() - 0.5) * 8),
        isChunk: false, settled: false, settleTime: 0,
      });
    }
  }

  // ── Dust ───────────────────────────────────────────────────────────

  private spawnDust(pos: Vector3, size: number, duration: number): void {
    if (this.dustClouds.length >= MAX_DUST) return;
    const ps = new ParticleSystem(`dust`, 40, this.scene);
    ps.createSphereEmitter(size * 0.5);
    ps.color1 = new Color4(0.7, 0.6, 0.5, 0.5);
    ps.color2 = new Color4(0.5, 0.45, 0.4, 0.3);
    ps.colorDead = new Color4(0.4, 0.35, 0.3, 0);
    ps.minSize = size * 0.8; ps.maxSize = size * 2;
    ps.minLifeTime = duration * 0.5; ps.maxLifeTime = duration * 1.5;
    ps.direction1 = new Vector3(-size * 0.3, size * 0.5, -size * 0.3);
    ps.direction2 = new Vector3(size * 0.3, size * 1.5, size * 0.3);
    ps.minEmitPower = 1; ps.maxEmitPower = 3;
    ps.emitter = pos.clone(); ps.emitRate = 25;
    ps.blendMode = ParticleSystem.BLENDMODE_STANDARD;
    ps.gravity = new Vector3(0, -2, 0);
    ps.start();
    setTimeout(() => { ps.emitRate = 0; }, 200);
    this.dustClouds.push({ particles: ps, lifetime: duration + 2 });
  }

  // ── Update Loop ────────────────────────────────────────────────────

  public update(deltaTime: number, playerPos?: Vector3): void {
    const now = performance.now();

    // Dust cleanup
    for (let i = this.dustClouds.length - 1; i >= 0; i--) {
      this.dustClouds[i].lifetime -= deltaTime;
      if (this.dustClouds[i].lifetime <= 0) {
        this.dustClouds[i].particles.dispose();
        this.dustClouds.splice(i, 1);
      }
    }

    // Force-clean settled debris when near cap
    if (this.debris.length > MAX_DEBRIS * 0.85) {
      for (let i = this.debris.length - 1; i >= 0 && this.debris.length > MAX_DEBRIS * 0.7; i--) {
        if (this.debris[i].settled) {
          this.debris[i].mesh.dispose();
          this.debris.splice(i, 1);
        }
      }
    }

    // Debris physics
    for (let i = this.debris.length - 1; i >= 0; i--) {
      const p = this.debris[i];
      if (p.settled) {
        if (now - p.settleTime > DEBRIS_SETTLE_TIME) { p.mesh.dispose(); this.debris.splice(i, 1); continue; }
        if (playerPos) {
          const dx = p.mesh.position.x - playerPos.x, dz = p.mesh.position.z - playerPos.z;
          if (dx * dx + dz * dz > DEBRIS_CLEANUP_DIST * DEBRIS_CLEANUP_DIST) { p.mesh.dispose(); this.debris.splice(i, 1); }
        }
        continue;
      }

      let grav = GRAVITY;
      if (this.gravityZone && this.getGravityAtPosition) {
        const zc = this.gravityZone.center;
        const dx = p.mesh.position.x - zc.x, dz = p.mesh.position.z - zc.z;
        if (dx * dx + dz * dz < this.gravityZone.radius ** 2 && p.mesh.position.y < 230) {
          grav = this.getGravityAtPosition(p.mesh.position);
        }
      }

      p.velocity.y += grav * deltaTime;
      if (p.isChunk) p.velocity.scaleInPlace(1 - 0.5 * deltaTime);
      p.mesh.position.x += p.velocity.x * deltaTime;
      p.mesh.position.y += p.velocity.y * deltaTime;
      p.mesh.position.z += p.velocity.z * deltaTime;
      p.mesh.rotation.x += p.angularVelocity.x * deltaTime;
      p.mesh.rotation.y += p.angularVelocity.y * deltaTime;
      p.mesh.rotation.z += p.angularVelocity.z * deltaTime;

      if (p.mesh.position.y < 0.3) {
        p.mesh.position.y = 0.3;
        p.velocity.y *= -0.3; p.velocity.x *= 0.6; p.velocity.z *= 0.6;
        p.angularVelocity.scaleInPlace(0.4);
        if (p.velocity.lengthSquared() < 1) {
          p.settled = true; p.settleTime = now;
          p.velocity.setAll(0); p.angularVelocity.setAll(0);
        }
      }
    }

    // Distance-based voxel building cleanup
    if (playerPos) {
      for (let i = this.buildingList.length - 1; i >= 0; i--) {
        const vb = this.buildingList[i];
        const mesh = vb.originalMeshes[0];
        if (!mesh || mesh.isDisposed()) {
          // Orphaned - chunk was unloaded
          vb.dispose();
          for (const m of vb.originalMeshes) {
            this.meshToBuilding.delete(m);
            this.buildings.delete(m);
          }
          this.buildingList.splice(i, 1);
          continue;
        }
        const dx = mesh.position.x - playerPos.x, dz = mesh.position.z - playerPos.z;
        if (dx * dx + dz * dz > VOXEL_CLEANUP_DIST ** 2) {
          // Far away - restore originals, dispose voxels
          for (const m of vb.originalMeshes) {
            m.isVisible = true;
            this.meshToBuilding.delete(m);
            this.buildings.delete(m);
          }
          vb.dispose();
          this.buildingList.splice(i, 1);
        }
      }
    }

    // Clean stale cooldowns
    if (this.damageCooldowns.size > 200) {
      for (const [m, t] of this.damageCooldowns) {
        if (now - t > 5000) this.damageCooldowns.delete(m);
      }
    }
  }
}
