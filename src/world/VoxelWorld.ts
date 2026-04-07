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
const MAX_DEBRIS = 200;
const DEBRIS_SETTLE_TIME = 12000;
const DEBRIS_CLEANUP_DIST = 120;
const VOXEL_CLEANUP_DIST = 350;
const AUTO_DESTROY_THRESHOLD = 0.08;
const DAMAGE_COOLDOWN = 60;
const GRAVITY = -30;
const MAX_DUST = 20;
const MAX_FALLING_BLOCKS = 50;  // Max individual voxel blocks falling at once

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

// No CollapsingSection type needed - disconnected blocks become individual debris

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
  // Leaning buildings (structurally compromised, tilting before collapse)
  private leaningBuildings: Map<VoxelBuilding, { angle: number; speed: number; dirX: number; dirZ: number }> = new Map();
  private debrisMaterials: StandardMaterial[] = [];

  // Gravity zone
  private gravityZone: GravityZone | null = null;
  private getGravityAtPosition: ((pos: Vector3) => number) | null = null;

  // Camera shake callback - set by main.ts to trigger screen shake on impacts
  public onCameraShake: ((intensity: number) => void) | null = null;

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
   * Explosive damage - blocks fly outward from impact with force.
   * Used by heat vision for dramatic explosive destruction.
   */
  public applyExplosiveDamage(mesh: Mesh, position: Vector3, power: number): void {
    const now = performance.now();
    const lastHit = this.damageCooldowns.get(mesh) || 0;
    if (now - lastHit < DAMAGE_COOLDOWN) return;
    this.damageCooldowns.set(mesh, now);

    Diag.count('Damage', 'explosiveHits');

    let vb = this.meshToBuilding.get(mesh);
    if (!vb) {
      const bounds = mesh.getBoundingInfo().boundingBox;
      if (bounds.maximumWorld.y - bounds.minimumWorld.y < 5) {
        mesh.isVisible = false; mesh.isPickable = false;
        if (this.physicsManager) this.physicsManager.removeCollisionMesh(mesh);
        return;
      }
      vb = this.voxelizeBuilding(mesh);
    }

    // Explosive radius scales with power
    const minDim = Math.min(vb.worldWidth, vb.worldDepth);
    const explosionRadius = Math.min(VOXEL_SIZE * 1.5 + power * 0.02, minDim * 0.4);
    const removed = vb.removeBlocksInRadius(position, explosionRadius);

    if (removed.length > 0) {
      Diag.track('Damage', 'blocksRemoved', removed.length);

      // Blocks EXPLODE outward from impact point with force
      const maxBlocks = Math.min(removed.length, MAX_DEBRIS - this.debris.length, 15);
      const step = removed.length > maxBlocks ? Math.floor(removed.length / maxBlocks) : 1;
      const explosionForce = 8 + power * 0.05;

      for (let i = 0; i < removed.length && this.debris.length < MAX_DEBRIS; i += step) {
        const pos = removed[i];
        // Direction: outward FROM impact point
        const dx = pos.x - position.x;
        const dy = pos.y - position.y;
        const dz = pos.z - position.z;
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
        const force = explosionForce * (1 + Math.random() * 0.5);

        const size = VOXEL_SIZE * (0.4 + Math.random() * 0.5);
        const m = MeshBuilder.CreateBox(`exp_${this.debris.length}`, {
          width: size, height: size * 0.7, depth: size
        }, this.scene);
        m.position.copyFrom(pos);
        m.rotation.set(Math.random(), Math.random() * Math.PI, Math.random());
        m.material = this.debrisMaterials[Math.floor(Math.random() * this.debrisMaterials.length)];
        m.isPickable = false;

        this.debris.push({
          mesh: m,
          velocity: new Vector3(
            (dx / dist) * force + (Math.random() - 0.5) * 5,
            (dy / dist) * force + Math.random() * force * 0.5 + 5,
            (dz / dist) * force + (Math.random() - 0.5) * 5
          ),
          angularVelocity: new Vector3(
            (Math.random() - 0.5) * 10,
            (Math.random() - 0.5) * 8,
            (Math.random() - 0.5) * 10
          ),
          isChunk: true,
          settled: false,
          settleTime: 0,
        });
      }

      // Explosion effects: flash, smoke, dust, shake
      this.spawnSmoke(position, 5 + removed.length * 0.3, removed.length * 2);
      this.spawnDust(position, 6 + removed.length * 0.2, 1.5);

      if (this.onCameraShake) {
        this.onCameraShake(Math.min(3, 0.5 + removed.length * 0.1));
      }

      // Structural cascade
      const disconnected = vb.findDisconnectedBlocks();
      if (disconnected.length > 0) {
        this.handleDisconnectedBlocks(vb, disconnected, position);
      }
    }

    if (vb.getPercentRemaining() < AUTO_DESTROY_THRESHOLD) {
      this.destroyBuilding(vb);
    } else {
      this.checkLean(vb);
    }
  }

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
    // Base radius scales with speed but is capped to prevent blowing through both walls.
    // At low speed (walking/heat vision ~50): small precise holes (radius ~3-5)
    // At high speed (220 m/s flight): larger holes (radius ~6-8) but still wall-only
    const minDim = Math.min(vb.worldWidth, vb.worldDepth);
    const maxRadius = Math.max(VOXEL_SIZE, minDim * 0.35);
    const baseRadius = VOXEL_SIZE * 0.8 + Math.min(VOXEL_SIZE, speed / 40);
    const punchRadius = Math.min(baseRadius, maxRadius);
    const removed = vb.removeBlocksInRadius(position, punchRadius);

    if (removed.length > 0) {
      Diag.track('Damage', 'blocksRemoved', removed.length);
      this.spawnDebrisFromPositions(removed, position, speed);
      this.spawnDust(position, 5, 1);

      // Structural integrity: find disconnected blocks
      const disconnected = vb.findDisconnectedBlocks();
      if (disconnected.length > 0) {
        this.handleDisconnectedBlocks(vb, disconnected, position);
      }
    }

    // Auto-destroy nearly empty buildings
    if (vb.getPercentRemaining() < AUTO_DESTROY_THRESHOLD) {
      this.destroyBuilding(vb);
    } else {
      // Check structural lean - asymmetric base damage causes building to tilt
      this.checkLean(vb);
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
    const maxRadius = Math.max(VOXEL_SIZE, minDim * 0.35);
    const baseRadius = VOXEL_SIZE * 0.8 + Math.min(VOXEL_SIZE, speed / 40);
    const punchRadius = Math.min(baseRadius, maxRadius);
    const removed = vb.removeBlocksInRadius(worldPos, punchRadius);

    if (removed.length > 0) {
      Diag.track('Damage', 'blocksRemoved', removed.length);
      this.spawnDebrisFromPositions(removed, worldPos, speed);
      this.spawnDust(worldPos, 5, 1);

      const disconnected = vb.findDisconnectedBlocks();
      if (disconnected.length > 0) {
        this.handleDisconnectedBlocks(vb, disconnected, worldPos);
      }
    }

    if (vb.getPercentRemaining() < AUTO_DESTROY_THRESHOLD) {
      this.destroyBuilding(vb);
    } else {
      this.checkLean(vb);
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
    if (this.dustClouds.length >= MAX_DUST * 2) return;
    const particleCount = Math.min(100, 30 + Math.floor(size * 5));
    const ps = new ParticleSystem(`dust`, particleCount, this.scene);
    ps.createSphereEmitter(size * 0.7);
    // Thick brown-gray dust cloud
    ps.color1 = new Color4(0.75, 0.65, 0.5, 0.7);
    ps.color2 = new Color4(0.55, 0.48, 0.38, 0.5);
    ps.colorDead = new Color4(0.4, 0.35, 0.3, 0);
    ps.minSize = size * 1.2; ps.maxSize = size * 3;
    ps.minLifeTime = duration; ps.maxLifeTime = duration * 2.5;
    ps.direction1 = new Vector3(-size * 0.5, size * 0.3, -size * 0.5);
    ps.direction2 = new Vector3(size * 0.5, size * 2, size * 0.5);
    ps.minEmitPower = 2; ps.maxEmitPower = 6;
    ps.emitter = pos.clone();
    ps.emitRate = Math.min(60, 15 + Math.floor(size * 3));
    ps.blendMode = ParticleSystem.BLENDMODE_STANDARD;
    ps.gravity = new Vector3(0, -1.5, 0);
    ps.start();
    // Emit for longer proportional to size
    const emitMs = Math.min(2000, 200 + Math.floor(size * 100));
    setTimeout(() => { ps.emitRate = 0; }, emitMs);
    this.dustClouds.push({ particles: ps, lifetime: duration + 4 });
  }

  // ── Structural Collapse ─────────────────────────────────────────────

  /**
   * Handle disconnected blocks: each block becomes a physics-driven debris
   * piece that falls, bounces, and piles up. Massive smoke on large collapses.
   */
  private handleDisconnectedBlocks(
    vb: VoxelBuilding, disconnected: { x: number; y: number; z: number }[], damagePos: Vector3
  ): void {
    // Remove all disconnected blocks from the grid
    const fallingPositions: Vector3[] = [];
    for (const { x, y, z } of disconnected) {
      const pos = vb.removeBlock(x, y, z);
      if (pos) fallingPositions.push(pos);
    }
    vb.flushChanges();

    if (fallingPositions.length === 0) return;

    // Each block becomes a real physics debris piece (capped for perf)
    const maxBlocks = Math.min(fallingPositions.length, MAX_FALLING_BLOCKS, MAX_DEBRIS - this.debris.length);
    // If we have more blocks than we can spawn, sample evenly
    const step = fallingPositions.length > maxBlocks
      ? Math.floor(fallingPositions.length / maxBlocks)
      : 1;

    for (let i = 0; i < fallingPositions.length && this.debris.length < MAX_DEBRIS; i += step) {
      const pos = fallingPositions[i];

      // Each debris piece is a voxel-sized block
      const sizeVar = 0.7 + Math.random() * 0.6;
      const m = MeshBuilder.CreateBox(`vfall_${this.debris.length}`, {
        width: VOXEL_SIZE * sizeVar * (0.5 + Math.random() * 0.5),
        height: VOXEL_SIZE * sizeVar * (0.3 + Math.random() * 0.5),
        depth: VOXEL_SIZE * sizeVar * (0.5 + Math.random() * 0.5),
      }, this.scene);
      m.position.copyFrom(pos);
      m.rotation.set(Math.random() * 0.3, Math.random() * Math.PI, Math.random() * 0.3);
      m.material = this.debrisMaterials[Math.floor(Math.random() * this.debrisMaterials.length)];
      m.isPickable = false;

      // Slight outward scatter from damage point + downward
      const dx = pos.x - damagePos.x;
      const dz = pos.z - damagePos.z;
      const dist = Math.sqrt(dx * dx + dz * dz) || 1;

      this.debris.push({
        mesh: m,
        velocity: new Vector3(
          (dx / dist) * (1 + Math.random() * 3),
          -1 - Math.random() * 2,  // Fall down
          (dz / dist) * (1 + Math.random() * 3)
        ),
        angularVelocity: new Vector3(
          (Math.random() - 0.5) * 4,
          (Math.random() - 0.5) * 2,
          (Math.random() - 0.5) * 4
        ),
        isChunk: true,
        settled: false,
        settleTime: 0,
      });
    }

    // Smoke + dust proportional to collapse size
    const collapseSize = fallingPositions.length;

    if (collapseSize >= 5) {
      // Find center and base of collapse for smoke placement
      let sumX = 0, sumZ = 0, baseY = Infinity;
      for (const p of fallingPositions) {
        sumX += p.x; sumZ += p.z;
        baseY = Math.min(baseY, p.y);
      }
      const centerX = sumX / fallingPositions.length;
      const centerZ = sumZ / fallingPositions.length;

      // MASSIVE smoke at the base - scales with collapse size
      const smokeSize = Math.min(20, 3 + collapseSize * 0.3);
      this.spawnSmoke(new Vector3(centerX, baseY, centerZ), smokeSize, collapseSize);

      // Dust cloud at the collapse center
      this.spawnDust(new Vector3(centerX, baseY + 5, centerZ), smokeSize * 0.8, 2);

      // Additional smoke puffs scattered around
      if (collapseSize > 20) {
        for (let i = 0; i < Math.min(3, Math.floor(collapseSize / 15)); i++) {
          const p = fallingPositions[Math.floor(Math.random() * fallingPositions.length)];
          this.spawnSmoke(new Vector3(p.x, baseY, p.z), smokeSize * 0.5, collapseSize * 0.3);
        }
      }
    }

    // Camera shake proportional to collapse size
    if (this.onCameraShake) {
      const shakeIntensity = Math.min(6, 1 + collapseSize * 0.1);
      this.onCameraShake(shakeIntensity);
    }

    Diag.log('Collapse', `${collapseSize} blocks falling, ${maxBlocks} debris spawned`);
  }

  /**
   * Spawn a rising smoke plume. Size and density scale with destruction.
   */
  private spawnSmoke(pos: Vector3, size: number, intensity: number = 10): void {
    if (this.dustClouds.length >= MAX_DUST * 2) return; // Higher cap for smoke

    const particleCount = Math.min(150, 30 + Math.floor(intensity * 3));
    const ps = new ParticleSystem('smoke', particleCount, this.scene);
    ps.createConeEmitter(size * 0.8, Math.PI / 5);

    // Dark billowing smoke
    ps.color1 = new Color4(0.35, 0.3, 0.25, 0.7);
    ps.color2 = new Color4(0.2, 0.18, 0.15, 0.5);
    ps.colorDead = new Color4(0.15, 0.13, 0.1, 0);

    ps.minSize = size * 1.5;
    ps.maxSize = size * 5;
    ps.minLifeTime = 2.5;
    ps.maxLifeTime = 6;

    // Smoke billows upward and outward
    ps.direction1 = new Vector3(-size * 0.4, size * 1.5, -size * 0.4);
    ps.direction2 = new Vector3(size * 0.4, size * 5, size * 0.4);
    ps.minEmitPower = 3;
    ps.maxEmitPower = 10;

    ps.emitter = pos.clone();
    ps.emitRate = Math.min(80, 15 + intensity * 2);
    ps.blendMode = ParticleSystem.BLENDMODE_STANDARD;
    ps.gravity = new Vector3(0, 2, 0); // Smoke rises

    ps.start();

    // Smoke emits for a duration proportional to collapse size, then fades
    const emitDuration = Math.min(3000, 500 + intensity * 50);
    setTimeout(() => { ps.emitRate = 0; }, emitDuration);

    this.dustClouds.push({ particles: ps, lifetime: 8 });
  }

  // ── Building Lean ───────────────────────────────────────────────────

  private checkLean(vb: VoxelBuilding): void {
    const lean = vb.calculateLean();
    if (!lean) {
      this.leaningBuildings.delete(vb);
      return;
    }

    if (lean.intensity > 0.6 && !this.leaningBuildings.has(vb)) {
      // Building starts leaning
      this.leaningBuildings.set(vb, {
        angle: 0,
        speed: 0.05 + lean.intensity * 0.2,
        dirX: lean.direction.x,
        dirZ: lean.direction.z,
      });
      Diag.log('Lean', `building starting to lean, intensity=${lean.intensity.toFixed(2)}`);
    }
  }

  private updateLeaningBuildings(deltaTime: number): void {
    for (const [vb, lean] of this.leaningBuildings) {
      // Accelerate the lean
      lean.speed += deltaTime * 0.8;
      lean.angle += lean.speed * deltaTime;

      // Apply visual lean to the voxel mesh
      vb.applyLean(lean.angle, lean.dirX, lean.dirZ);

      // Smoke from the base as it leans
      if (lean.angle > 0.05 && Math.random() < deltaTime * 3) {
        const basePos = new Vector3(
          vb.minWorld.x + (vb.maxWorld.x - vb.minWorld.x) * 0.5,
          vb.minWorld.y,
          vb.minWorld.z + (vb.maxWorld.z - vb.minWorld.z) * 0.5
        );
        this.spawnDust(basePos, 4, 1);
      }

      // Past tipping point: collapse entirely
      if (lean.angle > 0.4) { // ~23 degrees
        // Camera shake!
        if (this.onCameraShake) {
          this.onCameraShake(5);
        }

        // Massive smoke + dust at base
        const basePos = new Vector3(
          vb.minWorld.x + (vb.maxWorld.x - vb.minWorld.x) * 0.5,
          vb.minWorld.y,
          vb.minWorld.z + (vb.maxWorld.z - vb.minWorld.z) * 0.5
        );
        this.spawnSmoke(basePos, 15, 50);
        this.spawnDust(basePos, 12, 3);

        // Smoke at the "crash" point (where the top of the building hits)
        const crashPos = basePos.add(
          new Vector3(lean.dirX, 0, lean.dirZ).scale(vb.worldHeight * 0.7)
        );
        crashPos.y = 0;
        this.spawnSmoke(crashPos, 12, 40);
        this.spawnDust(crashPos, 10, 2.5);

        // Destroy the building - all remaining blocks become debris
        this.collapseEntireBuilding(vb);
        this.leaningBuildings.delete(vb);
      }
    }
  }

  /**
   * Collapse an entire building - all blocks become falling debris.
   */
  private collapseEntireBuilding(vb: VoxelBuilding): void {
    // Gather all remaining block positions
    const allBlocks: Vector3[] = [];
    for (let x = 0; x < vb.gridWidth; x++) {
      for (let y = 0; y < vb.gridHeight; y++) {
        for (let z = 0; z < vb.gridDepth; z++) {
          if (vb.isSolid(x, y, z)) {
            allBlocks.push(vb.gridToWorldPos(x, y, z));
          }
        }
      }
    }

    // Spawn debris from sampled blocks
    const center = new Vector3(
      (vb.minWorld.x + vb.maxWorld.x) * 0.5,
      vb.minWorld.y,
      (vb.minWorld.z + vb.maxWorld.z) * 0.5
    );
    this.handleDisconnectedBlocks(vb,
      allBlocks.map(p => {
        const g = vb.worldToGrid(p);
        return g || { x: 0, y: 0, z: 0 };
      }),
      center
    );

    // Destroy the building
    this.destroyBuilding(vb);
  }

  // ── Update Loop ────────────────────────────────────────────────────

  public update(deltaTime: number, playerPos?: Vector3): void {
    const now = performance.now();

    // Update leaning buildings (tilt, smoke, collapse when past tipping point)
    this.updateLeaningBuildings(deltaTime);

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
        const impactSpeed = Math.abs(p.velocity.y);
        p.mesh.position.y = 0.3;
        p.velocity.y *= -0.3; p.velocity.x *= 0.6; p.velocity.z *= 0.6;
        p.angularVelocity.scaleInPlace(0.4);

        // Camera shake on heavy impacts
        if (p.isChunk && impactSpeed > 10 && this.onCameraShake) {
          this.onCameraShake(Math.min(3, impactSpeed * 0.15));
        }

        // Dust puff on impact
        if (p.isChunk && impactSpeed > 8) {
          this.spawnDust(p.mesh.position.clone(), 2 + impactSpeed * 0.1, 0.5);
        }

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
