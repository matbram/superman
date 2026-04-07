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
const COLLAPSE_THRESHOLD = 12; // Min disconnected blocks to trigger falling section
const MAX_COLLAPSING = 8;      // Max simultaneous collapsing sections

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

interface CollapsingSection {
  mesh: Mesh;
  position: Vector3;       // Center of the section
  tiltAxis: Vector3;       // Axis to rotate around (perpendicular to fall direction)
  tiltAngle: number;       // Current tilt in radians
  tiltSpeed: number;       // Radians per second
  fallVelocity: number;    // Downward speed
  height: number;          // For ground detection
  groundY: number;         // Ground level
  impacted: boolean;       // Has hit the ground
  lifetime: number;        // Time since creation
  blockCount: number;      // For rubble scaling
  smokeEmitter: ParticleSystem | null;
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
  private collapsingSections: CollapsingSection[] = [];
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

  // ── Structural Collapse ─────────────────────────────────────────────

  /**
   * Handle disconnected blocks: small clusters become debris, large clusters
   * become a tilting/falling section with smoke effects.
   */
  private handleDisconnectedBlocks(
    vb: VoxelBuilding, disconnected: { x: number; y: number; z: number }[], damagePos: Vector3
  ): void {
    if (disconnected.length >= COLLAPSE_THRESHOLD && this.collapsingSections.length < MAX_COLLAPSING) {
      // Large cluster: create a falling section that tilts and crashes
      this.spawnCollapsingSection(vb, disconnected, damagePos);
    } else {
      // Small cluster: individual falling debris (limited per frame)
      const maxCascade = Math.min(disconnected.length, 15);
      const falling: Vector3[] = [];
      for (let i = 0; i < maxCascade; i++) {
        const pos = vb.removeBlock(disconnected[i].x, disconnected[i].y, disconnected[i].z);
        if (pos) falling.push(pos);
      }
      vb.flushChanges();
      this.spawnFallingDebris(falling);
    }
  }

  /**
   * Create a collapsing section from disconnected blocks.
   * The blocks are removed from the voxel grid and merged into a single
   * falling mesh that tilts toward the damage side and crashes down.
   */
  private spawnCollapsingSection(
    vb: VoxelBuilding, blocks: { x: number; y: number; z: number }[], damagePos: Vector3
  ): void {
    // Calculate bounds of the disconnected section
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    let sumX = 0, sumY = 0, sumZ = 0;

    for (const { x, y, z } of blocks) {
      const wp = vb.gridToWorldPos(x, y, z);
      minX = Math.min(minX, wp.x); maxX = Math.max(maxX, wp.x);
      minY = Math.min(minY, wp.y); maxY = Math.max(maxY, wp.y);
      minZ = Math.min(minZ, wp.z); maxZ = Math.max(maxZ, wp.z);
      sumX += wp.x; sumY += wp.y; sumZ += wp.z;
    }

    const center = new Vector3(sumX / blocks.length, sumY / blocks.length, sumZ / blocks.length);
    const sectionWidth = maxX - minX + VOXEL_SIZE;
    const sectionHeight = maxY - minY + VOXEL_SIZE;
    const sectionDepth = maxZ - minZ + VOXEL_SIZE;

    // Remove blocks from voxel grid
    for (const { x, y, z } of blocks) {
      vb.removeBlock(x, y, z);
    }
    vb.flushChanges();

    // Create a visual mesh for the falling section
    const sectionMesh = MeshBuilder.CreateBox(`collapse_${this.collapsingSections.length}`, {
      width: sectionWidth,
      height: sectionHeight,
      depth: sectionDepth,
    }, this.scene);
    sectionMesh.position.copyFrom(center);
    sectionMesh.material = this.debrisMaterials[Math.floor(Math.random() * this.debrisMaterials.length)];
    sectionMesh.isPickable = false;

    // Tilt direction: fall AWAY from the damage point (toward the missing support)
    const fallDir = center.subtract(damagePos);
    fallDir.y = 0;
    if (fallDir.lengthSquared() < 0.01) fallDir.x = 1; // Default if damage is directly below
    fallDir.normalize();

    // Tilt axis: perpendicular to fall direction (cross with up)
    const tiltAxis = Vector3.Cross(Vector3.Up(), fallDir).normalize();

    // Start smoke at the base of the collapsing section
    const smokeEmitter = this.spawnSmoke(new Vector3(center.x, minY, center.z), sectionWidth * 0.3);

    this.collapsingSections.push({
      mesh: sectionMesh,
      position: center.clone(),
      tiltAxis,
      tiltAngle: 0,
      tiltSpeed: 0.3 + Math.random() * 0.5, // Start slow, accelerate
      fallVelocity: 0,
      height: sectionHeight,
      groundY: 0,
      impacted: false,
      lifetime: 0,
      blockCount: blocks.length,
      smokeEmitter,
    });

    Diag.log('Collapse', `${blocks.length} blocks, ${sectionWidth.toFixed(0)}x${sectionHeight.toFixed(0)}x${sectionDepth.toFixed(0)}`);
  }

  /**
   * Spawn a rising smoke plume (darker than dust, longer lasting).
   */
  private spawnSmoke(pos: Vector3, size: number): ParticleSystem {
    const ps = new ParticleSystem('smoke', 60, this.scene);
    ps.createConeEmitter(size, Math.PI / 6);
    ps.color1 = new Color4(0.3, 0.3, 0.3, 0.6);
    ps.color2 = new Color4(0.2, 0.2, 0.2, 0.4);
    ps.colorDead = new Color4(0.15, 0.15, 0.15, 0);
    ps.minSize = size * 1.5;
    ps.maxSize = size * 4;
    ps.minLifeTime = 2;
    ps.maxLifeTime = 5;
    ps.direction1 = new Vector3(-size * 0.2, size * 2, -size * 0.2);
    ps.direction2 = new Vector3(size * 0.2, size * 4, size * 0.2);
    ps.minEmitPower = 2;
    ps.maxEmitPower = 6;
    ps.emitter = pos.clone();
    ps.emitRate = 40;
    ps.blendMode = ParticleSystem.BLENDMODE_STANDARD;
    ps.gravity = new Vector3(0, 1, 0); // Smoke rises
    ps.start();
    return ps;
  }

  /**
   * Spawn rubble pile at impact point when a section crashes down.
   */
  private spawnRubblePile(position: Vector3, blockCount: number, impactSpeed: number): void {
    const rubbleCount = Math.min(Math.floor(blockCount / 3), MAX_DEBRIS - this.debris.length, 12);
    const spread = Math.sqrt(blockCount) * VOXEL_SIZE * 0.3;

    for (let i = 0; i < rubbleCount; i++) {
      const size = 1 + Math.random() * 3;
      const m = MeshBuilder.CreateBox(`rubble_${this.debris.length}`, {
        width: size * (0.5 + Math.random() * 0.8),
        height: size * (0.3 + Math.random() * 0.4),
        depth: size * (0.5 + Math.random() * 0.8),
      }, this.scene);
      m.position.set(
        position.x + (Math.random() - 0.5) * spread,
        0.5 + Math.random() * 2,
        position.z + (Math.random() - 0.5) * spread
      );
      m.rotation.set(Math.random() * 0.3, Math.random() * Math.PI, Math.random() * 0.3);
      m.material = this.debrisMaterials[Math.floor(Math.random() * this.debrisMaterials.length)];
      m.isPickable = false;

      // Rubble scatters outward from impact
      const dx = m.position.x - position.x;
      const dz = m.position.z - position.z;
      this.debris.push({
        mesh: m,
        velocity: new Vector3(
          dx * 2 + (Math.random() - 0.5) * impactSpeed * 0.3,
          Math.random() * impactSpeed * 0.4 + 5,
          dz * 2 + (Math.random() - 0.5) * impactSpeed * 0.3
        ),
        angularVelocity: new Vector3(
          (Math.random() - 0.5) * 6,
          (Math.random() - 0.5) * 3,
          (Math.random() - 0.5) * 6
        ),
        isChunk: true,
        settled: false,
        settleTime: 0,
      });
    }
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

    // ── Update collapsing sections ──
    for (let i = this.collapsingSections.length - 1; i >= 0; i--) {
      const cs = this.collapsingSections[i];
      cs.lifetime += deltaTime;

      if (!cs.impacted) {
        // Accelerating tilt + fall
        cs.tiltSpeed += deltaTime * 1.5; // Angular acceleration
        cs.tiltAngle += cs.tiltSpeed * deltaTime;
        cs.fallVelocity += GRAVITY * deltaTime * 0.5; // Slower than freefall for dramatic effect

        // Apply tilt rotation around the base pivot point
        // Pivot is at the bottom of the section
        const pivotY = cs.position.y - cs.height * 0.5;
        const heightAbovePivot = cs.position.y - pivotY;

        // Update position: tilt causes horizontal drift + vertical drop
        cs.mesh.position.y += cs.fallVelocity * deltaTime;
        cs.mesh.position.x += Math.sin(cs.tiltAngle) * cs.tiltAxis.z * deltaTime * heightAbovePivot * 0.5;
        cs.mesh.position.z -= Math.sin(cs.tiltAngle) * cs.tiltAxis.x * deltaTime * heightAbovePivot * 0.5;

        // Apply rotation
        cs.mesh.rotationQuaternion = null;
        if (Math.abs(cs.tiltAxis.x) > 0.5) {
          cs.mesh.rotation.x = cs.tiltAngle * Math.sign(cs.tiltAxis.x);
        } else {
          cs.mesh.rotation.z = cs.tiltAngle * Math.sign(cs.tiltAxis.z);
        }

        // Smoke follows the section
        if (cs.smokeEmitter) {
          (cs.smokeEmitter.emitter as Vector3).copyFrom(cs.mesh.position);
          (cs.smokeEmitter.emitter as Vector3).y = pivotY;
        }

        // Ground impact check
        if (cs.mesh.position.y - cs.height * 0.5 <= cs.groundY || cs.tiltAngle > Math.PI * 0.45) {
          cs.impacted = true;
          cs.mesh.position.y = Math.max(cs.groundY + cs.height * 0.3, cs.mesh.position.y);

          // IMPACT: spawn rubble pile + massive dust + screen shake
          const impactPos = cs.mesh.position.clone();
          impactPos.y = cs.groundY;
          const impactSpeed = Math.abs(cs.fallVelocity) + cs.tiltSpeed * cs.height;

          this.spawnRubblePile(impactPos, cs.blockCount, impactSpeed);
          this.spawnDust(impactPos, 8 + cs.blockCount * 0.1, 2);
          this.spawnSmoke(impactPos, cs.blockCount * 0.15);

          // Stop the smoke emitter
          if (cs.smokeEmitter) {
            cs.smokeEmitter.emitRate = 0;
          }

          Diag.log('Collapse', `IMPACT ${cs.blockCount} blocks, speed=${impactSpeed.toFixed(0)}`);
        }
      } else {
        // Post-impact: sink into ground and fade
        cs.mesh.position.y -= deltaTime * 2;
        cs.mesh.visibility = Math.max(0, 1 - (cs.lifetime - 1) * 0.5);
      }

      // Cleanup after 4 seconds
      if (cs.lifetime > 4) {
        cs.mesh.dispose();
        if (cs.smokeEmitter) {
          cs.smokeEmitter.emitRate = 0;
          // Let particles finish naturally, then clean up
          this.dustClouds.push({ particles: cs.smokeEmitter, lifetime: 3 });
        }
        this.collapsingSections.splice(i, 1);
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
