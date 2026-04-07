/**
 * Building Damage System - Minecraft-style voxel destruction
 *
 * Clean architecture:
 * - ONE damage system: voxel grids only
 * - ONE entry point: applyDamage() with per-mesh cooldown
 * - Lifecycle management: auto-cleanup far buildings and empty buildings
 * - Original mesh stays as invisible raycast proxy (Babylon.js thin instance limitation)
 */

import { Scene } from '@babylonjs/core/scene';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { ParticleSystem } from '@babylonjs/core/Particles/particleSystem';
import { VoxelBuilding } from './VoxelBuilding';
import { PhysicsManager } from '../physics/physics';
import { Diag } from '../core/DiagnosticLog';
import type { GravityZone } from './AlienShip';

// ── Constants ──────────────────────────────────────────────────────────
const MAX_DEBRIS = 100;
const DEBRIS_SETTLE_TIME = 15000;     // 15 seconds
const DEBRIS_CLEANUP_DIST = 100;      // units from player
const VOXEL_CLEANUP_DIST = 300;       // dispose voxel buildings beyond this
const AUTO_DESTROY_THRESHOLD = 0.1;   // destroy when <10% blocks remain
const DAMAGE_COOLDOWN = 80;           // ms between hits on same mesh
const GRAVITY = -30;
const SECONDARY_FRAG_SPEED = 12;
const MAX_DUST_CLOUDS = 25;
const DUST_COOLDOWN = 200;            // ms between dust spawns at same grid position

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

// ── Main Class ─────────────────────────────────────────────────────────
export class BuildingDamage {
  private scene: Scene;
  private physicsManager: PhysicsManager | null;

  // Voxel buildings: original mesh → VoxelBuilding
  private voxelBuildings: Map<Mesh, VoxelBuilding> = new Map();
  // Reverse lookup: voxel thin-instance mesh → { original mesh, VoxelBuilding }
  private voxelMeshLookup: Map<Mesh, { original: Mesh; vb: VoxelBuilding }> = new Map();

  // Per-mesh damage cooldown (prevents duplicate hits same frame)
  private damageCooldowns: Map<Mesh, number> = new Map();

  // Debris and effects
  private debris: DebrisPiece[] = [];
  private dustClouds: DustCloud[] = [];
  private debrisMaterials: StandardMaterial[] = [];
  private lastDustSpawnTime: Map<string, number> = new Map();

  // Gravity zone (alien ship beam)
  private gravityZone: GravityZone | null = null;
  private getGravityAtPosition: ((position: Vector3) => number) | null = null;

  constructor(scene: Scene, physicsManager?: PhysicsManager) {
    this.scene = scene;
    this.physicsManager = physicsManager || null;
    this.createDebrisMaterials();
  }

  // ── Gravity Zone ───────────────────────────────────────────────────

  public setGravityZone(zone: GravityZone, gravityFunc: (position: Vector3) => number): void {
    this.gravityZone = zone;
    this.getGravityAtPosition = gravityFunc;
  }

  // ── Materials ──────────────────────────────────────────────────────

  private createDebrisMaterials(): void {
    const colors = [
      new Color3(0.5, 0.5, 0.55),
      new Color3(0.35, 0.35, 0.4),
      new Color3(0.45, 0.42, 0.4),
      new Color3(0.55, 0.52, 0.5),
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
    return this.voxelBuildings.has(mesh) || this.voxelMeshLookup.has(mesh);
  }

  /**
   * Get the VoxelBuilding for a mesh, if it exists.
   */
  public getVoxelBuilding(mesh: Mesh): VoxelBuilding | null {
    const vb = this.voxelBuildings.get(mesh);
    if (vb) return vb;
    const lookup = this.voxelMeshLookup.get(mesh);
    if (lookup) return lookup.vb;
    return null;
  }

  /**
   * Check if a world position inside a building has solid blocks.
   * Used by physics to decide: stop Superman (blocks exist) or let through (hole).
   * Returns true if NOT voxelized yet (treat as solid) or if solid blocks exist at position.
   */
  public hasSolidBlocksAt(mesh: Mesh, worldPos: Vector3): boolean {
    const vb = this.getVoxelBuilding(mesh);
    if (!vb) return true; // Not voxelized → treat as solid wall

    // Check a small area around the position (Superman's radius)
    const grid = vb.worldToGrid(worldPos);
    if (!grid) return false; // Outside grid → hole

    // Check 3x3x3 area around impact point
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dz = -1; dz <= 1; dz++) {
          if (vb.isSolid(grid.x + dx, grid.y + dy, grid.z + dz)) {
            return true; // At least one solid block nearby
          }
        }
      }
    }
    return false; // All blocks removed → it's a hole
  }

  // ── Single Damage Entry Point ──────────────────────────────────────

  /**
   * The ONE method that all damage sources call.
   * Handles: voxelization, block removal, debris, dust, cascade, auto-destroy.
   */
  public applyDamage(mesh: Mesh, position: Vector3, speed: number): void {
    // Per-mesh cooldown (prevents physics + Player raycast double-hit)
    const now = performance.now();
    const lastHit = this.damageCooldowns.get(mesh) || 0;
    if (now - lastHit < DAMAGE_COOLDOWN) return;
    this.damageCooldowns.set(mesh, now);

    Diag.count('Damage', 'hits');

    // Resolve mesh → VoxelBuilding
    let vb: VoxelBuilding;
    let originalMesh: Mesh = mesh;

    // Check if this is a voxel thin-instance mesh (reverse lookup)
    const lookup = this.voxelMeshLookup.get(mesh);
    if (lookup) {
      vb = lookup.vb;
      originalMesh = lookup.original;
    } else if (this.voxelBuildings.has(mesh)) {
      vb = this.voxelBuildings.get(mesh)!;
    } else {
      // Small decorative meshes (strips, small roofs <5 units) - just destroy
      const bounds = mesh.getBoundingInfo().boundingBox;
      const height = bounds.maximumWorld.y - bounds.minimumWorld.y;
      if (height < 5) {
        mesh.isVisible = false;
        mesh.isPickable = false;
        if (this.physicsManager) {
          this.physicsManager.removeCollisionMesh(mesh);
        }
        this.spawnDebris(position, speed, 3);
        this.spawnDust(position, 3, 0.5);
        return;
      }

      // First hit on this building - voxelize it
      vb = this.voxelize(mesh);
    }

    // Remove blocks at impact point
    const punchRadius = 3 + Math.min(6, speed / 20);
    const removed = vb.removeBlocksInRadius(position, punchRadius);

    if (removed.length > 0) {
      Diag.track('Damage', 'blocksRemoved', removed.length);
      this.spawnDebrisFromPositions(removed, position, speed);
      this.spawnDust(position, 5, 1);

      // Process unsupported blocks (1 cascade level per call)
      this.processUnsupportedBlocks(vb, originalMesh);
    }

    // Auto-destroy nearly empty buildings
    if (vb.getPercentRemaining() < AUTO_DESTROY_THRESHOLD) {
      this.destroyVoxelBuilding(originalMesh);
    }

    Diag.track('Damage', 'activeDebris', this.debris.length);
    Diag.track('Damage', 'voxelBuildings', this.voxelBuildings.size);
  }

  // ── Voxelization ──────────────────────────────────────────────────

  private voxelize(building: Mesh): VoxelBuilding {
    const bounds = building.getBoundingInfo().boundingBox;
    const size = bounds.maximumWorld.subtract(bounds.minimumWorld);
    const material = (building.material as StandardMaterial) || this.debrisMaterials[0];

    const vb = new VoxelBuilding(
      this.scene,
      new Vector3(building.position.x, bounds.minimumWorld.y, building.position.z),
      size.x, size.y, size.z,
      material,
      building.name
    );

    Diag.log('Voxelize', `${building.name} ${vb.gridWidth}x${vb.gridHeight}x${vb.gridDepth}`);

    // Hide original mesh visually but keep it pickable for raycasts
    // (Babylon.js thin instances can't be raycasted)
    building.isVisible = false;

    this.voxelBuildings.set(building, vb);
    this.voxelMeshLookup.set(vb.getMesh(), { original: building, vb });

    return vb;
  }

  private destroyVoxelBuilding(originalMesh: Mesh): void {
    const vb = this.voxelBuildings.get(originalMesh);
    if (!vb) return;

    vb.dispose();
    this.voxelMeshLookup.delete(vb.getMesh());
    this.voxelBuildings.delete(originalMesh);

    // Remove original mesh from collision and scene
    originalMesh.isPickable = false;
    if (this.physicsManager) {
      this.physicsManager.removeCollisionMesh(originalMesh);
    }
    originalMesh.dispose();

    Diag.count('Damage', 'buildingsDestroyed');
  }

  // ── Unsupported Block Cascade ──────────────────────────────────────

  private processUnsupportedBlocks(vb: VoxelBuilding, buildingMesh: Mesh): void {
    const unsupported = vb.findUnsupportedBlocks();
    if (unsupported.length === 0) return;

    const removedPositions: Vector3[] = [];
    for (const { x, y, z } of unsupported) {
      const pos = vb.removeBlock(x, y, z);
      if (pos) removedPositions.push(pos);
    }
    vb.flushChanges();

    // Spawn falling debris (limited count)
    const maxFalling = Math.min(removedPositions.length, MAX_DEBRIS - this.debris.length, 6);
    for (let i = 0; i < maxFalling; i++) {
      const pos = removedPositions[i];
      const size = 0.8 + Math.random() * 2;
      const rubble = MeshBuilder.CreateBox(`fall_${this.debris.length}`, {
        width: size * (0.5 + Math.random() * 0.7),
        height: size * (0.3 + Math.random() * 0.5),
        depth: size * (0.5 + Math.random() * 0.7),
      }, this.scene);
      rubble.position.copyFrom(pos);
      rubble.material = this.debrisMaterials[Math.floor(Math.random() * this.debrisMaterials.length)];
      rubble.isPickable = false;

      this.debris.push({
        mesh: rubble,
        velocity: new Vector3((Math.random() - 0.5) * 3, -2 - Math.random() * 3, (Math.random() - 0.5) * 3),
        angularVelocity: new Vector3((Math.random() - 0.5) * 3, (Math.random() - 0.5) * 2, (Math.random() - 0.5) * 3),
        isChunk: true,
        settled: false,
        settleTime: 0,
      });
    }

    if (removedPositions.length > 3) {
      this.spawnDust(removedPositions[Math.floor(removedPositions.length / 2)], 4, 1);
    }
  }

  // ── Debris Spawning ────────────────────────────────────────────────

  private spawnDebrisFromPositions(positions: Vector3[], impactPos: Vector3, speed: number): void {
    const maxSpawn = Math.min(positions.length, MAX_DEBRIS - this.debris.length, 10);
    for (let i = 0; i < maxSpawn; i++) {
      const pos = positions[i];
      const dirX = pos.x - impactPos.x;
      const dirZ = pos.z - impactPos.z;
      const dirLen = Math.sqrt(dirX * dirX + dirZ * dirZ) || 1;

      const size = 0.8 + Math.random() * 2;
      const rubble = MeshBuilder.CreateBox(`rbl_${this.debris.length}`, {
        width: size * (0.4 + Math.random() * 0.8),
        height: size * (0.3 + Math.random() * 0.5),
        depth: size * (0.4 + Math.random() * 0.8),
      }, this.scene);
      rubble.position.copyFrom(pos);
      rubble.material = this.debrisMaterials[Math.floor(Math.random() * this.debrisMaterials.length)];
      rubble.isPickable = false;
      rubble.rotation.set(Math.random(), Math.random() * Math.PI, Math.random());

      const push = Math.min(speed * 0.1, 10);
      this.debris.push({
        mesh: rubble,
        velocity: new Vector3(
          (dirX / dirLen) * push + (Math.random() - 0.5) * 4,
          1 + Math.random() * 4,
          (dirZ / dirLen) * push + (Math.random() - 0.5) * 4
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
  }

  private spawnDebris(position: Vector3, speed: number, count: number): void {
    const actual = Math.min(count, MAX_DEBRIS - this.debris.length);
    for (let i = 0; i < actual; i++) {
      const size = 0.3 + Math.random() * 1.2;
      const d = MeshBuilder.CreateBox(`d_${this.debris.length}`, {
        width: size * (0.4 + Math.random() * 0.6),
        height: size * (0.4 + Math.random() * 0.6),
        depth: size * (0.4 + Math.random() * 0.6),
      }, this.scene);
      d.position.set(
        position.x + (Math.random() - 0.5) * 4,
        position.y + (Math.random() - 0.5) * 4,
        position.z + (Math.random() - 0.5) * 4
      );
      d.material = this.debrisMaterials[Math.floor(Math.random() * this.debrisMaterials.length)];
      d.isPickable = false;

      this.debris.push({
        mesh: d,
        velocity: new Vector3(
          (Math.random() - 0.5) * speed * 0.3,
          Math.random() * speed * 0.2 + 5,
          (Math.random() - 0.5) * speed * 0.3
        ),
        angularVelocity: new Vector3(
          (Math.random() - 0.5) * 8,
          (Math.random() - 0.5) * 8,
          (Math.random() - 0.5) * 8
        ),
        isChunk: false,
        settled: false,
        settleTime: 0,
      });
    }
  }

  // ── Dust Clouds ────────────────────────────────────────────────────

  private spawnDust(position: Vector3, size: number, duration: number): void {
    if (this.dustClouds.length >= MAX_DUST_CLOUDS) return;

    const posKey = `${Math.round(position.x / 10) * 10}_${Math.round(position.z / 10) * 10}`;
    const now = performance.now();
    if (now - (this.lastDustSpawnTime.get(posKey) || 0) < DUST_COOLDOWN) return;
    this.lastDustSpawnTime.set(posKey, now);

    const particles = new ParticleSystem(`dust_${now}`, 50, this.scene);
    particles.createSphereEmitter(size * 0.5);
    particles.color1 = new Color4(0.7, 0.6, 0.5, 0.6);
    particles.color2 = new Color4(0.5, 0.45, 0.4, 0.4);
    particles.colorDead = new Color4(0.4, 0.35, 0.3, 0);
    particles.minSize = size * 0.8;
    particles.maxSize = size * 2;
    particles.minLifeTime = duration * 0.5;
    particles.maxLifeTime = duration * 1.5;
    particles.direction1 = new Vector3(-size * 0.3, size * 0.5, -size * 0.3);
    particles.direction2 = new Vector3(size * 0.3, size * 1.5, size * 0.3);
    particles.minEmitPower = 1;
    particles.maxEmitPower = 3;
    particles.emitter = position.clone();
    particles.emitRate = 30;
    particles.blendMode = ParticleSystem.BLENDMODE_STANDARD;
    particles.gravity = new Vector3(0, -2, 0);
    particles.start();
    setTimeout(() => { particles.emitRate = 0; }, 200);

    this.dustClouds.push({ particles, lifetime: duration + 2 });
  }

  // ── Chunk Cleanup ──────────────────────────────────────────────────

  /**
   * Called by City.ts when a chunk is unloaded.
   * Disposes any VoxelBuildings for meshes in that chunk.
   */
  public cleanupChunk(chunkKey: string): void {
    for (const [mesh, vb] of this.voxelBuildings) {
      if (mesh.name.includes(chunkKey)) {
        vb.dispose();
        this.voxelMeshLookup.delete(vb.getMesh());
        this.voxelBuildings.delete(mesh);
        this.damageCooldowns.delete(mesh);
      }
    }
  }

  // ── Update Loop ────────────────────────────────────────────────────

  public update(deltaTime: number, playerPosition?: Vector3): void {
    const now = performance.now();

    // ── Clean dust clouds ──
    for (let i = this.dustClouds.length - 1; i >= 0; i--) {
      this.dustClouds[i].lifetime -= deltaTime;
      if (this.dustClouds[i].lifetime <= 0) {
        this.dustClouds[i].particles.dispose();
        this.dustClouds.splice(i, 1);
      }
    }

    // ── Force-clean oldest settled debris when near cap ──
    if (this.debris.length > MAX_DEBRIS * 0.85) {
      for (let i = this.debris.length - 1; i >= 0 && this.debris.length > MAX_DEBRIS * 0.7; i--) {
        if (this.debris[i].settled) {
          this.debris[i].mesh.dispose();
          this.debris.splice(i, 1);
        }
      }
    }

    // ── Update debris physics ──
    for (let i = this.debris.length - 1; i >= 0; i--) {
      const piece = this.debris[i];

      // Settled debris: cleanup by time/distance
      if (piece.settled) {
        if (now - piece.settleTime > DEBRIS_SETTLE_TIME) {
          piece.mesh.dispose();
          this.debris.splice(i, 1);
          continue;
        }
        if (playerPosition) {
          const dx = piece.mesh.position.x - playerPosition.x;
          const dz = piece.mesh.position.z - playerPosition.z;
          if (dx * dx + dz * dz > DEBRIS_CLEANUP_DIST * DEBRIS_CLEANUP_DIST) {
            piece.mesh.dispose();
            this.debris.splice(i, 1);
          }
        }
        continue;
      }

      // Gravity (with alien beam zone support)
      let currentGravity = GRAVITY;
      let inGravityZone = false;
      if (this.gravityZone && this.getGravityAtPosition) {
        const zc = this.gravityZone.center;
        const dx = piece.mesh.position.x - zc.x;
        const dz = piece.mesh.position.z - zc.z;
        if (dx * dx + dz * dz < this.gravityZone.radius * this.gravityZone.radius && piece.mesh.position.y < 230) {
          inGravityZone = true;
          currentGravity = this.getGravityAtPosition(piece.mesh.position);
        }
      }

      piece.velocity.y += currentGravity * deltaTime;
      if (piece.isChunk) {
        piece.velocity.scaleInPlace(1 - (inGravityZone ? 0.3 : 0.5) * deltaTime);
      }

      // Position + rotation
      piece.mesh.position.x += piece.velocity.x * deltaTime;
      piece.mesh.position.y += piece.velocity.y * deltaTime;
      piece.mesh.position.z += piece.velocity.z * deltaTime;
      const rotMul = (inGravityZone ? 1.5 : 1.0) * deltaTime;
      piece.mesh.rotation.x += piece.angularVelocity.x * rotMul;
      piece.mesh.rotation.y += piece.angularVelocity.y * rotMul;
      piece.mesh.rotation.z += piece.angularVelocity.z * rotMul;

      // Ground collision
      const groundLevel = piece.isChunk ? 1 : 0.3;
      if (piece.mesh.position.y < groundLevel) {
        const impactSpeed = Math.abs(piece.velocity.y);
        piece.mesh.position.y = groundLevel;

        if (inGravityZone) {
          piece.velocity.y = Math.abs(piece.velocity.y) * 0.5 + 8;
          piece.velocity.x += (Math.random() - 0.5) * 10;
          piece.velocity.z += (Math.random() - 0.5) * 10;
        } else {
          piece.velocity.y *= -0.3;
          piece.velocity.x *= 0.6;
          piece.velocity.z *= 0.6;
          piece.angularVelocity.scaleInPlace(0.4);

          // Secondary fragmentation
          if (piece.isChunk && impactSpeed > SECONDARY_FRAG_SPEED && this.debris.length < MAX_DEBRIS) {
            const fragCount = Math.min(2, MAX_DEBRIS - this.debris.length);
            for (let f = 0; f < fragCount; f++) {
              const s = 0.5 + Math.random() * 1;
              const frag = MeshBuilder.CreateBox(`frag_${this.debris.length}`, {
                width: s, height: s * 0.5, depth: s,
              }, this.scene);
              frag.position.set(
                piece.mesh.position.x + (Math.random() - 0.5) * 2,
                groundLevel + 1,
                piece.mesh.position.z + (Math.random() - 0.5) * 2
              );
              frag.material = this.debrisMaterials[Math.floor(Math.random() * this.debrisMaterials.length)];
              frag.isPickable = false;
              this.debris.push({
                mesh: frag,
                velocity: new Vector3((Math.random() - 0.5) * impactSpeed * 0.4, Math.random() * impactSpeed * 0.3 + 3, (Math.random() - 0.5) * impactSpeed * 0.4),
                angularVelocity: new Vector3((Math.random() - 0.5) * 4, (Math.random() - 0.5) * 2, (Math.random() - 0.5) * 4),
                isChunk: false, settled: false, settleTime: 0,
              });
            }
            piece.isChunk = false;
          }

          // Settle check
          const vSq = piece.velocity.x ** 2 + piece.velocity.y ** 2 + piece.velocity.z ** 2;
          if (vSq < 1) {
            piece.settled = true;
            piece.settleTime = now;
            piece.velocity.setAll(0);
            piece.angularVelocity.setAll(0);
          }
        }
      }

      // Height cap in gravity zone
      if (inGravityZone && piece.mesh.position.y > 180) {
        piece.mesh.position.y = 180;
        piece.velocity.y = -Math.abs(piece.velocity.y) * 0.3;
      }
    }

    // ── Clean far-away voxel buildings ──
    if (playerPosition && this.voxelBuildings.size > 0) {
      for (const [mesh, vb] of this.voxelBuildings) {
        if (mesh.isDisposed()) {
          // Chunk was unloaded, clean up orphaned voxel building
          vb.dispose();
          this.voxelMeshLookup.delete(vb.getMesh());
          this.voxelBuildings.delete(mesh);
          this.damageCooldowns.delete(mesh);
          continue;
        }

        const dx = mesh.position.x - playerPosition.x;
        const dz = mesh.position.z - playerPosition.z;
        if (dx * dx + dz * dz > VOXEL_CLEANUP_DIST * VOXEL_CLEANUP_DIST) {
          // Far away - restore original mesh and dispose voxel
          mesh.isVisible = true;
          vb.dispose();
          this.voxelMeshLookup.delete(vb.getMesh());
          this.voxelBuildings.delete(mesh);
          this.damageCooldowns.delete(mesh);
        }
      }
    }

    // ── Clean stale cooldowns ──
    if (this.damageCooldowns.size > 200) {
      for (const [mesh, time] of this.damageCooldowns) {
        if (now - time > 5000) this.damageCooldowns.delete(mesh);
      }
    }

    // ── Clean stale dust cooldowns ──
    if (this.lastDustSpawnTime.size > 50) {
      for (const [key, time] of this.lastDustSpawnTime) {
        if (now - time > 2000) this.lastDustSpawnTime.delete(key);
      }
    }
  }
}
