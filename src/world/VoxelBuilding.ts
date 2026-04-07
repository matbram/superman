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
import { Vector3, Matrix, Quaternion } from '@babylonjs/core/Maths/math';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';

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

  // Reusable objects
  private static _tmpMatrix = Matrix.Identity();
  private static _tmpPosition = new Vector3();
  private static _zeroMatrix = Matrix.Scaling(0, 0, 0);

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

    // Create thin instance mesh
    this.blockMesh = MeshBuilder.CreateBox(
      'voxelBlock',
      { size: VOXEL_SIZE * 0.98 }, // Tiny gap between blocks for visual seam
      scene
    );
    this.blockMesh.material = material;
    this.blockMesh.isPickable = true;
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

          this.gridToInstance.set(`${x},${y},${z}`, idx);
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
  public removeBlock(x: number, y: number, z: number): Vector3 | null {
    if (!this.isSolid(x, y, z)) return null;

    this.grid[x][y][z] = false;

    // Hide the thin instance by zeroing its matrix
    const key = `${x},${y},${z}`;
    const instanceIdx = this.gridToInstance.get(key);
    if (instanceIdx !== undefined) {
      VoxelBuilding._zeroMatrix.copyToArray(this.instanceMatrices, instanceIdx * 16);
      this.blockMesh.thinInstanceBufferUpdated('matrix');
    }

    return this.gridToWorld(x, y, z);
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
          // Cylindrical check (ignore Y for punch-through)
          if (dx * dx + dz * dz > gridRadius * gridRadius) continue;

          // Remove at the hit Y level and a few above/below for body height
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

    return removed;
  }

  /**
   * Checks structural support and returns list of unsupported blocks.
   * A block is unsupported if there's no solid block directly below it
   * and it's not on the ground floor.
   */
  public findUnsupportedBlocks(): { x: number; y: number; z: number }[] {
    const unsupported: { x: number; y: number; z: number }[] = [];

    // Check from bottom up - ground floor (y=0) is always supported
    for (let y = 1; y < this.gridHeight; y++) {
      for (let x = 0; x < this.gridWidth; x++) {
        for (let z = 0; z < this.gridDepth; z++) {
          if (!this.grid[x][y][z]) continue;

          // Check if any block directly below supports this one
          // A block is supported if ANY adjacent block below it is solid
          let supported = false;
          for (let dx = -SUPPORT_CHECK_RADIUS; dx <= SUPPORT_CHECK_RADIUS && !supported; dx++) {
            for (let dz = -SUPPORT_CHECK_RADIUS; dz <= SUPPORT_CHECK_RADIUS && !supported; dz++) {
              if (this.isSolid(x + dx, y - 1, z + dz)) {
                supported = true;
              }
            }
          }

          if (!supported) {
            unsupported.push({ x, y, z });
          }
        }
      }
    }

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
