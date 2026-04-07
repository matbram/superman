/**
 * VoxelBuilding - A destructible building made of small blocks.
 *
 * Uses Babylon.js thin instances for performance: all blocks of one material
 * render in a single draw call. Individual blocks can be removed by zeroing
 * their transform matrix in the instance buffer.
 *
 * Buildings are represented as a 3D grid where each cell is either solid or empty.
 * Removing a cell:
 *   1. Marks grid cell as empty
 *   2. Updates the thin instance matrix to hide it (scale=0)
 *   3. Spawns rubble debris at that position
 *   4. Checks structural support - unsupported blocks above fall too
 */

import { Scene } from '@babylonjs/core/scene';
import { Vector3, Matrix } from '@babylonjs/core/Maths/math';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import '@babylonjs/core/Meshes/thinInstanceMesh';

// Voxel size in world units - small enough to look like building detail,
// big enough to keep instance count manageable
const VOXEL_SIZE = 3;

// Only build shell (exterior faces) - no interior voxels needed
// This dramatically reduces instance count
const SHELL_ONLY = true;

// Structural constants
const SUPPORT_CHECK_RADIUS = 1; // Check adjacent blocks for support

/**
 * Represents a single destructible voxel building
 */
export class VoxelBuilding {
  private scene: Scene;

  // Grid state: true = solid, false = empty
  private grid: boolean[][][]; // [x][y][z]
  readonly gridWidth: number;
  readonly gridHeight: number;
  readonly gridDepth: number;

  // Thin instance rendering
  private blockMesh: Mesh;         // Base mesh (one cube, many instances)
  private instanceMatrices: Float32Array;
  private instanceCount: number = 0;

  // Map from grid coords to instance index (for hiding specific blocks)
  private gridToInstance: Map<string, number> = new Map();

  // World position of the building's bottom-center
  readonly worldPosition: Vector3;
  readonly worldWidth: number;
  readonly worldHeight: number;
  readonly worldDepth: number;

  // For damage callbacks
  public onBlockRemoved: ((worldPos: Vector3, count: number) => void) | null = null;

  // Dirty column tracking - only scan these columns for unsupported blocks
  private dirtyColumns: Set<string> = new Set();

  // Map from instance index back to grid key (for swap-and-shrink)
  private instanceToGrid: string[] = [];

  // Reusable objects
  private static _tmpMatrix = Matrix.Identity();
  private static _tmpPosition = new Vector3();

  constructor(
    scene: Scene,
    position: Vector3,
    width: number,
    height: number,
    depth: number,
    material: StandardMaterial
  ) {
    this.scene = scene;
    this.worldPosition = position.clone();
    this.worldWidth = width;
    this.worldHeight = height;
    this.worldDepth = depth;

    // Calculate grid dimensions
    this.gridWidth = Math.max(2, Math.round(width / VOXEL_SIZE));
    this.gridHeight = Math.max(3, Math.round(height / VOXEL_SIZE));
    this.gridDepth = Math.max(2, Math.round(depth / VOXEL_SIZE));

    // Initialize grid - all solid
    this.grid = [];
    for (let x = 0; x < this.gridWidth; x++) {
      this.grid[x] = [];
      for (let y = 0; y < this.gridHeight; y++) {
        this.grid[x][y] = [];
        for (let z = 0; z < this.gridDepth; z++) {
          if (SHELL_ONLY) {
            // Only create exterior faces (shell)
            const isExterior = x === 0 || x === this.gridWidth - 1
              || y === 0 || y === this.gridHeight - 1
              || z === 0 || z === this.gridDepth - 1;
            this.grid[x][y][z] = isExterior;
          } else {
            this.grid[x][y][z] = true;
          }
        }
      }
    }

    // Create thin instance mesh - slight overlap to eliminate visible seams
    this.blockMesh = MeshBuilder.CreateBox(
      'voxelBlock',
      { size: VOXEL_SIZE * 1.01 },
      scene
    );
    this.blockMesh.material = material;
    this.blockMesh.isPickable = false;
    this.blockMesh.receiveShadows = true;

    // Build instance buffer
    this.buildInstances();
  }

  /**
   * Builds the thin instance buffer from the grid state.
   * Called once at creation and can be called to rebuild after bulk changes.
   */
  private buildInstances(): void {
    // Count solid blocks
    let count = 0;
    for (let x = 0; x < this.gridWidth; x++) {
      for (let y = 0; y < this.gridHeight; y++) {
        for (let z = 0; z < this.gridDepth; z++) {
          if (this.grid[x][y][z]) count++;
        }
      }
    }

    this.instanceCount = count;
    // 16 floats per 4x4 matrix
    this.instanceMatrices = new Float32Array(count * 16);
    this.gridToInstance.clear();
    this.instanceToGrid = [];

    let idx = 0;
    for (let x = 0; x < this.gridWidth; x++) {
      for (let y = 0; y < this.gridHeight; y++) {
        for (let z = 0; z < this.gridDepth; z++) {
          if (!this.grid[x][y][z]) continue;

          const worldX = this.worldPosition.x - this.worldWidth * 0.5 + (x + 0.5) * VOXEL_SIZE;
          const worldY = this.worldPosition.y + (y + 0.5) * VOXEL_SIZE;
          const worldZ = this.worldPosition.z - this.worldDepth * 0.5 + (z + 0.5) * VOXEL_SIZE;

          Matrix.TranslationToRef(worldX, worldY, worldZ, VoxelBuilding._tmpMatrix);
          VoxelBuilding._tmpMatrix.copyToArray(this.instanceMatrices, idx * 16);

          const key = `${x},${y},${z}`;
          this.gridToInstance.set(key, idx);
          this.instanceToGrid[idx] = key;
          idx++;
        }
      }
    }

    // Apply to mesh
    this.blockMesh.thinInstanceSetBuffer('matrix', this.instanceMatrices, 16, false);
  }

  /**
   * Converts a world position to grid coordinates
   */
  public worldToGrid(worldPos: Vector3): { x: number; y: number; z: number } | null {
    const localX = worldPos.x - (this.worldPosition.x - this.worldWidth * 0.5);
    const localY = worldPos.y - this.worldPosition.y;
    const localZ = worldPos.z - (this.worldPosition.z - this.worldDepth * 0.5);

    const gx = Math.floor(localX / VOXEL_SIZE);
    const gy = Math.floor(localY / VOXEL_SIZE);
    const gz = Math.floor(localZ / VOXEL_SIZE);

    if (gx < 0 || gx >= this.gridWidth || gy < 0 || gy >= this.gridHeight || gz < 0 || gz >= this.gridDepth) {
      return null;
    }

    return { x: gx, y: gy, z: gz };
  }

  /**
   * Converts grid coordinates to world position (center of block)
   */
  public gridToWorld(gx: number, gy: number, gz: number): Vector3 {
    return new Vector3(
      this.worldPosition.x - this.worldWidth * 0.5 + (gx + 0.5) * VOXEL_SIZE,
      this.worldPosition.y + (gy + 0.5) * VOXEL_SIZE,
      this.worldPosition.z - this.worldDepth * 0.5 + (gz + 0.5) * VOXEL_SIZE
    );
  }

  /**
   * Checks if a grid cell is solid
   */
  public isSolid(x: number, y: number, z: number): boolean {
    if (x < 0 || x >= this.gridWidth || y < 0 || y >= this.gridHeight || z < 0 || z >= this.gridDepth) {
      return false;
    }
    return this.grid[x][y][z];
  }

  /**
   * Removes a single block at grid coordinates.
   * Returns the world position of the removed block, or null if already empty.
   */
  // Track whether buffer needs updating (batch multiple removes per frame)
  private bufferDirty = false;

  public removeBlock(x: number, y: number, z: number): Vector3 | null {
    if (!this.isSolid(x, y, z)) return null;

    this.grid[x][y][z] = false;

    // Mark this column and neighbors as dirty for structural support check
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        this.dirtyColumns.add(`${x + dx},${z + dz}`);
      }
    }

    // Swap-and-shrink: move the last instance into this slot, then shrink count.
    // This avoids zero-scale matrices which break hardware instancing in Babylon.js.
    const key = `${x},${y},${z}`;
    const removeIdx = this.gridToInstance.get(key);
    if (removeIdx !== undefined) {
      const lastIdx = this.instanceCount - 1;

      if (removeIdx !== lastIdx) {
        // Copy last instance's matrix into the removed slot
        const srcOffset = lastIdx * 16;
        const dstOffset = removeIdx * 16;
        for (let i = 0; i < 16; i++) {
          this.instanceMatrices[dstOffset + i] = this.instanceMatrices[srcOffset + i];
        }

        // Update the maps: the grid key that was at lastIdx is now at removeIdx
        const lastKey = this.instanceToGrid[lastIdx];
        this.gridToInstance.set(lastKey, removeIdx);
        this.instanceToGrid[removeIdx] = lastKey;
      }

      // Remove from maps
      this.gridToInstance.delete(key);
      this.instanceCount--;

      this.bufferDirty = true;
    }

    return this.gridToWorld(x, y, z);
  }

  /**
   * Flushes pending instance buffer changes to the GPU.
   * Call after a batch of removeBlock calls for efficiency.
   */
  public flushChanges(): void {
    if (!this.bufferDirty) return;
    this.bufferDirty = false;

    // Update the thin instance buffer with new count
    this.blockMesh.thinInstanceSetBuffer(
      'matrix',
      this.instanceMatrices.subarray(0, this.instanceCount * 16),
      16,
      false
    );
  }

  /**
   * Removes blocks in a sphere around a world position.
   * Returns array of world positions of removed blocks.
   */
  public removeBlocksInRadius(worldPos: Vector3, radius: number): Vector3[] {
    const removed: Vector3[] = [];
    const gridRadius = Math.ceil(radius / VOXEL_SIZE);
    const center = this.worldToGrid(worldPos);
    if (!center) return removed;

    const radiusSq = radius * radius;

    for (let dx = -gridRadius; dx <= gridRadius; dx++) {
      for (let dy = -gridRadius; dy <= gridRadius; dy++) {
        for (let dz = -gridRadius; dz <= gridRadius; dz++) {
          const gx = center.x + dx;
          const gy = center.y + dy;
          const gz = center.z + dz;

          if (!this.isSolid(gx, gy, gz)) continue;

          // Check sphere distance
          const wx = (dx * VOXEL_SIZE);
          const wy = (dy * VOXEL_SIZE);
          const wz = (dz * VOXEL_SIZE);
          if (wx * wx + wy * wy + wz * wz > radiusSq) continue;

          const pos = this.removeBlock(gx, gy, gz);
          if (pos) removed.push(pos);
        }
      }
    }

    this.flushChanges();
    return removed;
  }

  /**
   * Removes blocks along a ray (for Superman punch-through).
   * Returns array of world positions of removed blocks.
   */
  public removeBlocksAlongRay(origin: Vector3, direction: Vector3, radius: number): Vector3[] {
    const removed: Vector3[] = [];
    const gridRadius = Math.ceil(radius / VOXEL_SIZE);

    // Step along the ray through the building
    const step = VOXEL_SIZE * 0.5;
    const maxDist = Math.sqrt(this.worldWidth * this.worldWidth + this.worldDepth * this.worldDepth) + VOXEL_SIZE;

    for (let d = -VOXEL_SIZE; d < maxDist; d += step) {
      const px = origin.x + direction.x * d;
      const py = origin.y + direction.y * d;
      const pz = origin.z + direction.z * d;

      VoxelBuilding._tmpPosition.set(px, py, pz);
      const center = this.worldToGrid(VoxelBuilding._tmpPosition);
      if (!center) continue;

      // Remove blocks in cylinder around ray
      for (let dx = -gridRadius; dx <= gridRadius; dx++) {
        for (let dz = -gridRadius; dz <= gridRadius; dz++) {
          if (dx * dx + dz * dz > gridRadius * gridRadius) continue;

          for (let dy = -1; dy <= 1; dy++) {
            const gx = center.x + dx;
            const gy = center.y + dy;
            const gz = center.z + dz;
            const pos = this.removeBlock(gx, gy, gz);
            if (pos) removed.push(pos);
          }
        }
      }
    }

    this.flushChanges();
    return removed;
  }

  /**
   * Checks structural support and returns list of unsupported blocks.
   * A block is unsupported if there's no solid block directly below it
   * and it's not on the ground floor.
   */
  /**
   * Finds unsupported blocks, but ONLY in columns that were recently modified.
   * O(height × dirtyColumns) instead of O(width × height × depth).
   */
  public findUnsupportedBlocks(): { x: number; y: number; z: number }[] {
    const unsupported: { x: number; y: number; z: number }[] = [];

    if (this.dirtyColumns.size === 0) return unsupported;

    // Only scan columns that had blocks removed recently
    for (const colKey of this.dirtyColumns) {
      const parts = colKey.split(',');
      const cx = parseInt(parts[0]);
      const cz = parseInt(parts[1]);

      if (cx < 0 || cx >= this.gridWidth || cz < 0 || cz >= this.gridDepth) continue;

      // Scan this column from bottom up
      for (let y = 1; y < this.gridHeight; y++) {
        if (!this.grid[cx][y][cz]) continue;

        // Check if any adjacent block below supports this one
        let supported = false;
        for (let dx = -1; dx <= 1 && !supported; dx++) {
          for (let dz = -1; dz <= 1 && !supported; dz++) {
            if (this.isSolid(cx + dx, y - 1, cz + dz)) {
              supported = true;
            }
          }
        }

        if (!supported) {
          unsupported.push({ x: cx, y, z: cz });
        }
      }
    }

    // Clear dirty columns after processing
    this.dirtyColumns.clear();

    return unsupported;
  }

  /**
   * Returns the total number of solid blocks remaining
   */
  public getSolidCount(): number {
    let count = 0;
    for (let x = 0; x < this.gridWidth; x++) {
      for (let y = 0; y < this.gridHeight; y++) {
        for (let z = 0; z < this.gridDepth; z++) {
          if (this.grid[x][y][z]) count++;
        }
      }
    }
    return count;
  }

  /**
   * Returns the highest Y level that still has solid blocks
   */
  public getTopLevel(): number {
    for (let y = this.gridHeight - 1; y >= 0; y--) {
      for (let x = 0; x < this.gridWidth; x++) {
        for (let z = 0; z < this.gridDepth; z++) {
          if (this.grid[x][y][z]) return y;
        }
      }
    }
    return -1;
  }

  /**
   * Gets the underlying mesh for scene integration (collision, shadows, etc.)
   */
  public getMesh(): Mesh {
    return this.blockMesh;
  }

  /**
   * Disposes all resources
   */
  public dispose(): void {
    this.blockMesh.dispose();
    this.gridToInstance.clear();
  }
}
