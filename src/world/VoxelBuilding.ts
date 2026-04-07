/**
 * VoxelBuilding - A destructible building made of individual blocks.
 *
 * Each building is a 3D boolean grid. Blocks can be individually removed.
 * Rendering uses Babylon.js thin instances (one draw call per building).
 * Collision uses direct grid queries (no Babylon.js raycasting needed).
 *
 * Key algorithms:
 * - Swap-and-shrink: O(1) block removal without GPU waste
 * - DDA raycast: exact per-block collision at any angle
 * - Flood-fill: structural integrity via connected-component analysis
 * - Shell-only: only exterior faces rendered (~35% fewer instances)
 */

import { Scene } from '@babylonjs/core/scene';
import { Vector3, Matrix } from '@babylonjs/core/Maths/math';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import '@babylonjs/core/Meshes/thinInstanceMesh';

export const VOXEL_SIZE = 4;
const SHELL_ONLY = true;

// ── Interfaces ─────────────────────────────────────────────────────────

export interface VoxelRayHit {
  hit: boolean;
  point: Vector3;
  normal: Vector3;
  distance: number;
  gridX: number;
  gridY: number;
  gridZ: number;
}

const NO_HIT: VoxelRayHit = {
  hit: false,
  point: Vector3.Zero(),
  normal: Vector3.Up(),
  distance: Infinity,
  gridX: -1, gridY: -1, gridZ: -1,
};

// ── VoxelBuilding ──────────────────────────────────────────────────────

export class VoxelBuilding {
  private scene: Scene;

  // Grid state: true = solid, false = empty
  private grid: boolean[][][];
  readonly gridWidth: number;
  readonly gridHeight: number;
  readonly gridDepth: number;

  // World-space axis-aligned bounding box
  readonly minWorld: Vector3;
  readonly maxWorld: Vector3;

  // World position of building origin (bottom-center)
  readonly worldPosition: Vector3;
  readonly worldWidth: number;
  readonly worldHeight: number;
  readonly worldDepth: number;

  // Thin instance rendering
  private blockMesh: Mesh;
  private instanceMatrices: Float32Array;
  private instanceCount: number = 0;

  // Grid↔instance mapping for swap-and-shrink
  private gridToInstance: Map<string, number> = new Map();
  private instanceToGrid: string[] = [];

  // Dirty column tracking for structural support
  private dirtyColumns: Set<string> = new Set();
  private bufferDirty = false;

  // Original meshes that were merged into this voxel building
  readonly originalMeshes: Mesh[];

  // Reusable statics
  private static _tmpMatrix = Matrix.Identity();

  constructor(
    scene: Scene,
    meshes: Mesh[],
    material: StandardMaterial
  ) {
    this.scene = scene;
    this.originalMeshes = meshes;

    // Compute unified bounding box across ALL meshes
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

    for (const mesh of meshes) {
      const bounds = mesh.getBoundingInfo().boundingBox;
      minX = Math.min(minX, bounds.minimumWorld.x);
      minY = Math.min(minY, bounds.minimumWorld.y);
      minZ = Math.min(minZ, bounds.minimumWorld.z);
      maxX = Math.max(maxX, bounds.maximumWorld.x);
      maxY = Math.max(maxY, bounds.maximumWorld.y);
      maxZ = Math.max(maxZ, bounds.maximumWorld.z);
    }

    this.worldWidth = maxX - minX;
    this.worldHeight = maxY - minY;
    this.worldDepth = maxZ - minZ;

    // Origin at bottom-center of unified bounds
    this.worldPosition = new Vector3((minX + maxX) * 0.5, minY, (minZ + maxZ) * 0.5);
    this.minWorld = new Vector3(minX, minY, minZ);
    this.maxWorld = new Vector3(maxX, maxY, maxZ);

    // Grid dimensions
    this.gridWidth = Math.max(2, Math.round(this.worldWidth / VOXEL_SIZE));
    this.gridHeight = Math.max(3, Math.round(this.worldHeight / VOXEL_SIZE));
    this.gridDepth = Math.max(2, Math.round(this.worldDepth / VOXEL_SIZE));

    // Initialize grid - mark cells that overlap with ANY original mesh as solid
    this.grid = [];
    for (let x = 0; x < this.gridWidth; x++) {
      this.grid[x] = [];
      for (let y = 0; y < this.gridHeight; y++) {
        this.grid[x][y] = [];
        for (let z = 0; z < this.gridDepth; z++) {
          // World position of this grid cell center
          const wx = minX + (x + 0.5) * VOXEL_SIZE;
          const wy = minY + (y + 0.5) * VOXEL_SIZE;
          const wz = minZ + (z + 0.5) * VOXEL_SIZE;

          // Check if this cell is inside any of the original meshes
          let inside = false;
          for (const mesh of meshes) {
            const b = mesh.getBoundingInfo().boundingBox;
            if (wx >= b.minimumWorld.x && wx <= b.maximumWorld.x &&
                wy >= b.minimumWorld.y && wy <= b.maximumWorld.y &&
                wz >= b.minimumWorld.z && wz <= b.maximumWorld.z) {
              inside = true;
              break;
            }
          }

          if (SHELL_ONLY && inside) {
            // Only keep exterior faces of the unified shape
            const isExterior = x === 0 || x === this.gridWidth - 1
              || y === 0 || y === this.gridHeight - 1
              || z === 0 || z === this.gridDepth - 1
              // Also keep faces at the boundary of each individual mesh
              || !this.isInsideAnyMesh(meshes, minX + (x - 0.5) * VOXEL_SIZE, wy, wz)
              || !this.isInsideAnyMesh(meshes, minX + (x + 1.5) * VOXEL_SIZE, wy, wz)
              || !this.isInsideAnyMesh(meshes, wx, minY + (y - 0.5) * VOXEL_SIZE, wz)
              || !this.isInsideAnyMesh(meshes, wx, minY + (y + 1.5) * VOXEL_SIZE, wz)
              || !this.isInsideAnyMesh(meshes, wx, wy, minZ + (z - 0.5) * VOXEL_SIZE)
              || !this.isInsideAnyMesh(meshes, wx, wy, minZ + (z + 1.5) * VOXEL_SIZE);
            this.grid[x][y][z] = isExterior;
          } else {
            this.grid[x][y][z] = inside;
          }
        }
      }
    }

    // Create thin instance mesh
    const name = meshes[0]?.name || 'building_voxel';
    this.blockMesh = MeshBuilder.CreateBox(
      name + '_voxels',
      { size: VOXEL_SIZE * 1.01 },
      scene
    );
    this.blockMesh.material = material;
    this.blockMesh.isPickable = false;
    this.blockMesh.receiveShadows = true;

    this.buildInstances();
  }

  private isInsideAnyMesh(meshes: Mesh[], wx: number, wy: number, wz: number): boolean {
    for (const mesh of meshes) {
      const b = mesh.getBoundingInfo().boundingBox;
      if (wx >= b.minimumWorld.x && wx <= b.maximumWorld.x &&
          wy >= b.minimumWorld.y && wy <= b.maximumWorld.y &&
          wz >= b.minimumWorld.z && wz <= b.maximumWorld.z) {
        return true;
      }
    }
    return false;
  }

  // ── Instance Buffer Management ─────────────────────────────────────

  private buildInstances(): void {
    let count = 0;
    for (let x = 0; x < this.gridWidth; x++)
      for (let y = 0; y < this.gridHeight; y++)
        for (let z = 0; z < this.gridDepth; z++)
          if (this.grid[x][y][z]) count++;

    this.instanceCount = count;
    this.instanceMatrices = new Float32Array(count * 16);
    this.gridToInstance.clear();
    this.instanceToGrid = [];

    let idx = 0;
    const minX = this.minWorld.x;
    const minY = this.minWorld.y;
    const minZ = this.minWorld.z;

    for (let x = 0; x < this.gridWidth; x++) {
      for (let y = 0; y < this.gridHeight; y++) {
        for (let z = 0; z < this.gridDepth; z++) {
          if (!this.grid[x][y][z]) continue;
          const wx = minX + (x + 0.5) * VOXEL_SIZE;
          const wy = minY + (y + 0.5) * VOXEL_SIZE;
          const wz = minZ + (z + 0.5) * VOXEL_SIZE;
          Matrix.TranslationToRef(wx, wy, wz, VoxelBuilding._tmpMatrix);
          VoxelBuilding._tmpMatrix.copyToArray(this.instanceMatrices, idx * 16);
          const key = `${x},${y},${z}`;
          this.gridToInstance.set(key, idx);
          this.instanceToGrid[idx] = key;
          idx++;
        }
      }
    }

    this.blockMesh.thinInstanceSetBuffer('matrix', this.instanceMatrices, 16, false);
  }

  // ── World ↔ Grid Conversion ────────────────────────────────────────

  public worldToGrid(worldPos: Vector3): { x: number; y: number; z: number } | null {
    const gx = Math.floor((worldPos.x - this.minWorld.x) / VOXEL_SIZE);
    const gy = Math.floor((worldPos.y - this.minWorld.y) / VOXEL_SIZE);
    const gz = Math.floor((worldPos.z - this.minWorld.z) / VOXEL_SIZE);
    if (gx < 0 || gx >= this.gridWidth || gy < 0 || gy >= this.gridHeight || gz < 0 || gz >= this.gridDepth) {
      return null;
    }
    return { x: gx, y: gy, z: gz };
  }

  public gridToWorldPos(gx: number, gy: number, gz: number): Vector3 {
    return new Vector3(
      this.minWorld.x + (gx + 0.5) * VOXEL_SIZE,
      this.minWorld.y + (gy + 0.5) * VOXEL_SIZE,
      this.minWorld.z + (gz + 0.5) * VOXEL_SIZE
    );
  }

  // ── Direct Collision Queries ───────────────────────────────────────

  /** Is the world-space point inside this building's bounding box? */
  public containsPoint(p: Vector3): boolean {
    return p.x >= this.minWorld.x && p.x <= this.maxWorld.x
      && p.y >= this.minWorld.y && p.y <= this.maxWorld.y
      && p.z >= this.minWorld.z && p.z <= this.maxWorld.z;
  }

  /** Is there a solid block at this world position? */
  public isSolidAtWorld(p: Vector3): boolean {
    const g = this.worldToGrid(p);
    return g !== null && this.grid[g.x][g.y][g.z];
  }

  /** Grid-level solid check */
  public isSolid(x: number, y: number, z: number): boolean {
    if (x < 0 || x >= this.gridWidth || y < 0 || y >= this.gridHeight || z < 0 || z >= this.gridDepth) return false;
    return this.grid[x][y][z];
  }

  // ── DDA Raycast Through Voxel Grid ─────────────────────────────────

  /**
   * Cast a ray through the voxel grid using DDA (Digital Differential Analyzer).
   * Returns the first solid block hit with exact position and face normal.
   * This is how Minecraft does raycasting - O(distance/voxelSize) steps.
   */
  public raycast(origin: Vector3, direction: Vector3, maxDist: number = 500): VoxelRayHit {
    // Ray-AABB intersection to find entry point
    let tMin = 0;
    let tMax = maxDist;

    const invDirX = direction.x !== 0 ? 1 / direction.x : (direction.x >= 0 ? 1e30 : -1e30);
    const invDirY = direction.y !== 0 ? 1 / direction.y : (direction.y >= 0 ? 1e30 : -1e30);
    const invDirZ = direction.z !== 0 ? 1 / direction.z : (direction.z >= 0 ? 1e30 : -1e30);

    const t1x = (this.minWorld.x - origin.x) * invDirX;
    const t2x = (this.maxWorld.x - origin.x) * invDirX;
    tMin = Math.max(tMin, Math.min(t1x, t2x));
    tMax = Math.min(tMax, Math.max(t1x, t2x));

    const t1y = (this.minWorld.y - origin.y) * invDirY;
    const t2y = (this.maxWorld.y - origin.y) * invDirY;
    tMin = Math.max(tMin, Math.min(t1y, t2y));
    tMax = Math.min(tMax, Math.max(t1y, t2y));

    const t1z = (this.minWorld.z - origin.z) * invDirZ;
    const t2z = (this.maxWorld.z - origin.z) * invDirZ;
    tMin = Math.max(tMin, Math.min(t1z, t2z));
    tMax = Math.min(tMax, Math.max(t1z, t2z));

    if (tMin > tMax || tMax < 0) return NO_HIT;

    // Start position (clamp to entry point if outside)
    const startT = Math.max(0, tMin - 0.01);
    const sx = origin.x + direction.x * startT;
    const sy = origin.y + direction.y * startT;
    const sz = origin.z + direction.z * startT;

    // Current grid cell
    let gx = Math.floor((sx - this.minWorld.x) / VOXEL_SIZE);
    let gy = Math.floor((sy - this.minWorld.y) / VOXEL_SIZE);
    let gz = Math.floor((sz - this.minWorld.z) / VOXEL_SIZE);

    // Clamp to grid bounds
    gx = Math.max(0, Math.min(gx, this.gridWidth - 1));
    gy = Math.max(0, Math.min(gy, this.gridHeight - 1));
    gz = Math.max(0, Math.min(gz, this.gridDepth - 1));

    // DDA step direction
    const stepX = direction.x >= 0 ? 1 : -1;
    const stepY = direction.y >= 0 ? 1 : -1;
    const stepZ = direction.z >= 0 ? 1 : -1;

    // Distance to next grid boundary for each axis
    const cellMinX = this.minWorld.x + gx * VOXEL_SIZE;
    const cellMinY = this.minWorld.y + gy * VOXEL_SIZE;
    const cellMinZ = this.minWorld.z + gz * VOXEL_SIZE;

    let tMaxX = invDirX * ((stepX > 0 ? cellMinX + VOXEL_SIZE : cellMinX) - sx);
    let tMaxY = invDirY * ((stepY > 0 ? cellMinY + VOXEL_SIZE : cellMinY) - sy);
    let tMaxZ = invDirZ * ((stepZ > 0 ? cellMinZ + VOXEL_SIZE : cellMinZ) - sz);

    const tDeltaX = Math.abs(VOXEL_SIZE * invDirX);
    const tDeltaY = Math.abs(VOXEL_SIZE * invDirY);
    const tDeltaZ = Math.abs(VOXEL_SIZE * invDirZ);

    // If direction component is zero, set tMax to infinity (never step that axis)
    if (direction.x === 0) tMaxX = Infinity;
    if (direction.y === 0) tMaxY = Infinity;
    if (direction.z === 0) tMaxZ = Infinity;

    // Walk through grid
    const maxSteps = this.gridWidth + this.gridHeight + this.gridDepth;
    let lastStepAxis = -1; // 0=X, 1=Y, 2=Z

    for (let step = 0; step < maxSteps; step++) {
      // Check current cell
      if (gx >= 0 && gx < this.gridWidth && gy >= 0 && gy < this.gridHeight && gz >= 0 && gz < this.gridDepth) {
        if (this.grid[gx][gy][gz]) {
          // HIT! Calculate exact hit point and normal
          const hitPoint = this.gridToWorldPos(gx, gy, gz);
          const dist = Vector3.Distance(origin, hitPoint);

          // Normal based on which face we entered from
          let normal: Vector3;
          if (lastStepAxis === 0) normal = new Vector3(-stepX, 0, 0);
          else if (lastStepAxis === 1) normal = new Vector3(0, -stepY, 0);
          else if (lastStepAxis === 2) normal = new Vector3(0, 0, -stepZ);
          else normal = direction.scale(-1).normalize();

          return { hit: true, point: hitPoint, normal, distance: dist, gridX: gx, gridY: gy, gridZ: gz };
        }
      }

      // Step to next cell (DDA)
      if (tMaxX < tMaxY) {
        if (tMaxX < tMaxZ) {
          gx += stepX;
          tMaxX += tDeltaX;
          lastStepAxis = 0;
        } else {
          gz += stepZ;
          tMaxZ += tDeltaZ;
          lastStepAxis = 2;
        }
      } else {
        if (tMaxY < tMaxZ) {
          gy += stepY;
          tMaxY += tDeltaY;
          lastStepAxis = 1;
        } else {
          gz += stepZ;
          tMaxZ += tDeltaZ;
          lastStepAxis = 2;
        }
      }

      // Out of bounds?
      if (gx < 0 || gx >= this.gridWidth || gy < 0 || gy >= this.gridHeight || gz < 0 || gz >= this.gridDepth) {
        break;
      }
    }

    return NO_HIT;
  }

  // ── Block Removal (Swap-and-Shrink) ────────────────────────────────

  public removeBlock(x: number, y: number, z: number): Vector3 | null {
    if (!this.isSolid(x, y, z)) return null;
    this.grid[x][y][z] = false;

    // Dirty columns for structural check
    for (let dx = -1; dx <= 1; dx++)
      for (let dz = -1; dz <= 1; dz++)
        this.dirtyColumns.add(`${x + dx},${z + dz}`);

    // Swap-and-shrink: move last instance into removed slot
    const key = `${x},${y},${z}`;
    const removeIdx = this.gridToInstance.get(key);
    if (removeIdx !== undefined) {
      const lastIdx = this.instanceCount - 1;
      if (removeIdx !== lastIdx) {
        const srcOff = lastIdx * 16;
        const dstOff = removeIdx * 16;
        for (let i = 0; i < 16; i++)
          this.instanceMatrices[dstOff + i] = this.instanceMatrices[srcOff + i];
        const lastKey = this.instanceToGrid[lastIdx];
        this.gridToInstance.set(lastKey, removeIdx);
        this.instanceToGrid[removeIdx] = lastKey;
      }
      this.gridToInstance.delete(key);
      this.instanceCount--;
      this.bufferDirty = true;
    }

    return this.gridToWorldPos(x, y, z);
  }

  public flushChanges(): void {
    if (!this.bufferDirty) return;
    this.bufferDirty = false;
    this.blockMesh.thinInstanceSetBuffer(
      'matrix',
      this.instanceMatrices.subarray(0, this.instanceCount * 16),
      16, false
    );
  }

  public removeBlocksInRadius(worldPos: Vector3, radius: number): Vector3[] {
    const removed: Vector3[] = [];
    const gridRadius = Math.ceil(radius / VOXEL_SIZE);
    const center = this.worldToGrid(worldPos);
    if (!center) return removed;
    const radiusSq = radius * radius;

    for (let dx = -gridRadius; dx <= gridRadius; dx++)
      for (let dy = -gridRadius; dy <= gridRadius; dy++)
        for (let dz = -gridRadius; dz <= gridRadius; dz++) {
          const wx = dx * VOXEL_SIZE, wy = dy * VOXEL_SIZE, wz = dz * VOXEL_SIZE;
          if (wx * wx + wy * wy + wz * wz > radiusSq) continue;
          const pos = this.removeBlock(center.x + dx, center.y + dy, center.z + dz);
          if (pos) removed.push(pos);
        }

    this.flushChanges();
    return removed;
  }

  // ── Structural Integrity ───────────────────────────────────────────

  /**
   * Flood-fill from ground level to find blocks NOT connected to ground.
   * Returns disconnected clusters as arrays of grid positions.
   * Much more robust than column-check - handles overhangs, arches, etc.
   */
  public findDisconnectedBlocks(): { x: number; y: number; z: number }[] {
    if (this.dirtyColumns.size === 0) return [];

    // BFS from all ground-level blocks to mark connected blocks
    const connected = new Uint8Array(this.gridWidth * this.gridHeight * this.gridDepth);
    const queue: number[] = []; // packed as x + y*gw + z*gw*gh

    const gw = this.gridWidth;
    const gh = this.gridHeight;
    const pack = (x: number, y: number, z: number) => x + y * gw + z * gw * gh;

    // Seed: all solid blocks at ground level (y=0)
    for (let x = 0; x < gw; x++) {
      for (let z = 0; z < this.gridDepth; z++) {
        if (this.grid[x][0][z]) {
          const idx = pack(x, 0, z);
          connected[idx] = 1;
          queue.push(idx);
        }
      }
    }

    // BFS flood fill upward/outward
    const dirs = [
      [1, 0, 0], [-1, 0, 0],
      [0, 1, 0], [0, -1, 0],
      [0, 0, 1], [0, 0, -1],
    ];

    let head = 0;
    while (head < queue.length) {
      const packed = queue[head++];
      const z = Math.floor(packed / (gw * gh));
      const y = Math.floor((packed - z * gw * gh) / gw);
      const x = packed - z * gw * gh - y * gw;

      for (const [dx, dy, dz] of dirs) {
        const nx = x + dx, ny = y + dy, nz = z + dz;
        if (nx < 0 || nx >= gw || ny < 0 || ny >= gh || nz < 0 || nz >= this.gridDepth) continue;
        const ni = pack(nx, ny, nz);
        if (connected[ni] || !this.grid[nx][ny][nz]) continue;
        connected[ni] = 1;
        queue.push(ni);
      }
    }

    // Any solid block NOT in connected set is disconnected
    const disconnected: { x: number; y: number; z: number }[] = [];
    // Only check dirty columns for efficiency
    for (const colKey of this.dirtyColumns) {
      const parts = colKey.split(',');
      const cx = parseInt(parts[0]);
      const cz = parseInt(parts[1]);
      if (cx < 0 || cx >= gw || cz < 0 || cz >= this.gridDepth) continue;

      for (let y = 1; y < gh; y++) {
        if (this.grid[cx][y][cz] && !connected[pack(cx, y, cz)]) {
          disconnected.push({ x: cx, y, z: cz });
        }
      }
    }

    this.dirtyColumns.clear();
    return disconnected;
  }

  /**
   * Calculate the structural lean of the building based on asymmetric damage.
   * Returns a lean vector (XZ direction) and intensity (0=stable, 1=falling over).
   * Buildings lean toward the side with the most damage at the base.
   */
  public calculateLean(): { direction: Vector3; intensity: number } | null {
    if (this.gridHeight < 4) return null;

    // Count solid blocks on each side at the base (bottom 30%)
    const baseHeight = Math.max(2, Math.floor(this.gridHeight * 0.3));
    let countXNeg = 0, countXPos = 0, countZNeg = 0, countZPos = 0;
    let totalBase = 0;
    const halfX = this.gridWidth / 2;
    const halfZ = this.gridDepth / 2;

    for (let y = 0; y < baseHeight; y++) {
      for (let x = 0; x < this.gridWidth; x++) {
        for (let z = 0; z < this.gridDepth; z++) {
          if (this.grid[x][y][z]) {
            totalBase++;
            if (x < halfX) countXNeg++; else countXPos++;
            if (z < halfZ) countZNeg++; else countZPos++;
          }
        }
      }
    }

    if (totalBase === 0) return null;

    // Calculate asymmetry - lean toward the side with FEWER blocks (missing support)
    const maxPossible = baseHeight * this.gridWidth * this.gridDepth * 0.5;
    const asymX = (countXPos - countXNeg) / Math.max(1, maxPossible);
    const asymZ = (countZPos - countZNeg) / Math.max(1, maxPossible);

    // Lean direction: toward the weaker side
    const leanX = -asymX; // Lean toward side with fewer blocks
    const leanZ = -asymZ;
    const leanMag = Math.sqrt(leanX * leanX + leanZ * leanZ);

    if (leanMag < 0.3) return null; // Need significant asymmetry to lean

    // Intensity: how much of the base is destroyed
    const fullBase = this.gridWidth * baseHeight * this.gridDepth;
    const baseDamage = 1 - (totalBase / Math.max(1, fullBase));
    // Need >50% base damage to start leaning significantly
    const intensity = Math.min(1, baseDamage * 1.2 + leanMag * 0.3);

    return {
      direction: new Vector3(leanX / leanMag, 0, leanZ / leanMag),
      intensity,
    };
  }

  /**
   * Apply a lean transformation to the mesh. The building visually tilts.
   */
  public applyLean(angle: number, axisX: number, axisZ: number): void {
    this.blockMesh.rotationQuaternion = null;
    // Lean around the base (pivot at bottom center)
    this.blockMesh.setPivotPoint(new Vector3(0, -(this.worldHeight * 0.5), 0));
    if (Math.abs(axisX) > Math.abs(axisZ)) {
      this.blockMesh.rotation.z = angle * Math.sign(axisX);
    } else {
      this.blockMesh.rotation.x = angle * Math.sign(axisZ);
    }
  }

  // ── Queries ────────────────────────────────────────────────────────

  public getPercentRemaining(): number {
    return this.instanceCount / Math.max(1, this.gridWidth * this.gridHeight * this.gridDepth);
  }

  public getInstanceCount(): number {
    return this.instanceCount;
  }

  public getMesh(): Mesh {
    return this.blockMesh;
  }

  public dispose(): void {
    this.blockMesh.dispose();
    this.gridToInstance.clear();
  }
}
