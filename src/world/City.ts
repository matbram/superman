/**
 * Optimized Procedural Infinite City Generator
 * Uses mesh merging, shared materials, and throttled generation for performance
 */

import { Scene } from '@babylonjs/core/scene';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { ShadowGenerator } from '@babylonjs/core/Lights/Shadows/shadowGenerator';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { PhysicsManager, createCollisionBox } from '../physics/physics';

// Chunk and city generation constants
const CHUNK_SIZE = 200; // Larger chunks = fewer total chunks
const LOAD_RADIUS = 2;
const UNLOAD_DISTANCE = 3;

// Building generation - simplified for performance
const SIDEWALK_HEIGHT = 0.15;
const MIN_BUILDING_HEIGHT = 25;
const MAX_BUILDING_HEIGHT = 90;
const MIN_BUILDING_WIDTH = 15;
const MAX_BUILDING_WIDTH = 30;
const BUILDING_SPACING = 12;
const BUILDINGS_PER_CHUNK = 8; // Limit buildings per chunk

/**
 * Seeded random for deterministic chunk generation
 */
class SeededRandom {
  private seed: number;

  constructor(seed: number = 12345) {
    this.seed = seed;
  }

  public next(): number {
    this.seed = (this.seed * 1103515245 + 12345) & 0x7fffffff;
    return this.seed / 0x7fffffff;
  }

  public range(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  public intRange(min: number, max: number): number {
    return Math.floor(this.range(min, max + 1));
  }
}

/**
 * City chunk data
 */
interface CityChunk {
  key: string;
  chunkX: number;
  chunkZ: number;
  mergedMesh: Mesh | null;
  collisionMeshes: Mesh[];
  lastAccess: number;
}

/**
 * Pending chunk for throttled generation
 */
interface PendingChunk {
  chunkX: number;
  chunkZ: number;
}

/**
 * Optimized procedural city generator
 */
export class City {
  private scene: Scene;
  private physicsManager: PhysicsManager;
  private shadowGenerator: ShadowGenerator;
  private baseSeed: number;

  private chunks: Map<string, CityChunk> = new Map();
  private pendingChunks: PendingChunk[] = [];
  private groundMesh: Mesh | null = null;

  // Shared materials - reused across all buildings
  private buildingMaterials: StandardMaterial[] = [];
  private sidewalkMaterial!: StandardMaterial;

  constructor(
    scene: Scene,
    physicsManager: PhysicsManager,
    shadowGenerator: ShadowGenerator,
    seed: number = 42
  ) {
    this.scene = scene;
    this.physicsManager = physicsManager;
    this.shadowGenerator = shadowGenerator;
    this.baseSeed = seed;

    // Create shared materials once
    this.createSharedMaterials();

    // Create ground
    this.createGround();

    // Generate initial chunks
    this.updateChunks(new Vector3(0, 0, 0));
  }

  /**
   * Creates all shared materials upfront
   */
  private createSharedMaterials(): void {
    // Building materials - only create a few, reuse them
    const colors = [
      new Color3(0.65, 0.65, 0.7),
      new Color3(0.55, 0.5, 0.48),
      new Color3(0.48, 0.52, 0.56),
      new Color3(0.6, 0.55, 0.5),
    ];

    for (let i = 0; i < colors.length; i++) {
      const mat = new StandardMaterial(`buildingMat_${i}`, this.scene);
      mat.diffuseColor = colors[i];
      mat.specularColor = new Color3(0.1, 0.1, 0.1);
      mat.freeze(); // Freeze material for better performance
      this.buildingMaterials.push(mat);
    }

    // Sidewalk material
    this.sidewalkMaterial = new StandardMaterial('sidewalkMat', this.scene);
    this.sidewalkMaterial.diffuseColor = new Color3(0.5, 0.5, 0.5);
    this.sidewalkMaterial.specularColor = new Color3(0.05, 0.05, 0.05);
    this.sidewalkMaterial.freeze();
  }

  /**
   * Creates the ground plane
   */
  private createGround(): void {
    this.groundMesh = MeshBuilder.CreateGround(
      'cityGround',
      { width: 4000, height: 4000 },
      this.scene
    );

    const groundMat = new StandardMaterial('groundMat', this.scene);
    groundMat.diffuseColor = new Color3(0.25, 0.32, 0.22);
    groundMat.specularColor = new Color3(0.02, 0.02, 0.02);
    groundMat.freeze();

    this.groundMesh.material = groundMat;
    this.groundMesh.receiveShadows = true;
    this.groundMesh.isPickable = true;
    this.groundMesh.freezeWorldMatrix();
    createCollisionBox(this.groundMesh, this.physicsManager);
  }

  /**
   * Updates loaded chunks - with throttled generation
   */
  public updateChunks(playerPosition: Vector3): void {
    const playerChunkX = Math.floor(playerPosition.x / CHUNK_SIZE);
    const playerChunkZ = Math.floor(playerPosition.z / CHUNK_SIZE);

    // Queue chunks that need loading
    for (let dx = -LOAD_RADIUS; dx <= LOAD_RADIUS; dx++) {
      for (let dz = -LOAD_RADIUS; dz <= LOAD_RADIUS; dz++) {
        const chunkX = playerChunkX + dx;
        const chunkZ = playerChunkZ + dz;
        const key = `${chunkX},${chunkZ}`;

        if (!this.chunks.has(key)) {
          // Check if already pending
          const isPending = this.pendingChunks.some(
            p => p.chunkX === chunkX && p.chunkZ === chunkZ
          );
          if (!isPending) {
            this.pendingChunks.push({ chunkX, chunkZ });
          }
        } else {
          const chunk = this.chunks.get(key)!;
          chunk.lastAccess = performance.now();
        }
      }
    }

    // Generate only 1 pending chunk per frame to avoid stutters
    if (this.pendingChunks.length > 0) {
      // Sort by distance to player (generate closest first)
      this.pendingChunks.sort((a, b) => {
        const distA = Math.abs(a.chunkX - playerChunkX) + Math.abs(a.chunkZ - playerChunkZ);
        const distB = Math.abs(b.chunkX - playerChunkX) + Math.abs(b.chunkZ - playerChunkZ);
        return distA - distB;
      });

      const next = this.pendingChunks.shift()!;
      this.generateChunk(next.chunkX, next.chunkZ);
    }

    // Unload distant chunks
    const now = performance.now();
    for (const [key, chunk] of this.chunks.entries()) {
      const dx = Math.abs(chunk.chunkX - playerChunkX);
      const dz = Math.abs(chunk.chunkZ - playerChunkZ);

      if (dx > UNLOAD_DISTANCE || dz > UNLOAD_DISTANCE) {
        if (now - chunk.lastAccess > 3000) {
          this.unloadChunk(key);
        }
      }
    }
  }

  /**
   * Generates a city chunk with merged geometry
   */
  private generateChunk(chunkX: number, chunkZ: number): void {
    const key = `${chunkX},${chunkZ}`;
    const chunkSeed = this.hashCoords(chunkX, chunkZ);
    const random = new SeededRandom(chunkSeed);

    const worldX = chunkX * CHUNK_SIZE;
    const worldZ = chunkZ * CHUNK_SIZE;
    const halfChunk = CHUNK_SIZE / 2;

    // Collect building data for merging
    const buildingData: {
      positions: number[];
      indices: number[];
      normals: number[];
    } = { positions: [], indices: [], normals: [] };

    const collisionMeshes: Mesh[] = [];
    let indexOffset = 0;

    // Create sidewalk
    const sidewalk = MeshBuilder.CreateBox(
      `sidewalk_${key}`,
      { width: CHUNK_SIZE - 20, height: SIDEWALK_HEIGHT, depth: CHUNK_SIZE - 20 },
      this.scene
    );
    sidewalk.position = new Vector3(worldX + halfChunk, SIDEWALK_HEIGHT / 2, worldZ + halfChunk);
    sidewalk.material = this.sidewalkMaterial;
    sidewalk.receiveShadows = true;
    sidewalk.freezeWorldMatrix();
    createCollisionBox(sidewalk, this.physicsManager);
    collisionMeshes.push(sidewalk);

    // Generate buildings
    let buildingCount = 0;
    let currentX = worldX + BUILDING_SPACING;
    const endX = worldX + CHUNK_SIZE - BUILDING_SPACING;
    const endZ = worldZ + CHUNK_SIZE - BUILDING_SPACING;

    while (currentX < endX && buildingCount < BUILDINGS_PER_CHUNK) {
      let currentZ = worldZ + BUILDING_SPACING;

      while (currentZ < endZ && buildingCount < BUILDINGS_PER_CHUNK) {
        const bWidth = random.range(MIN_BUILDING_WIDTH, MAX_BUILDING_WIDTH);
        const bDepth = random.range(MIN_BUILDING_WIDTH, MAX_BUILDING_WIDTH);
        const bHeight = random.range(MIN_BUILDING_HEIGHT, MAX_BUILDING_HEIGHT);

        const bx = currentX + bWidth / 2;
        const by = bHeight / 2 + SIDEWALK_HEIGHT;
        const bz = currentZ + bDepth / 2;

        // Add building geometry to merged data
        const boxData = this.createBoxVertexData(bx, by, bz, bWidth, bHeight, bDepth);

        // Offset indices
        for (const idx of boxData.indices) {
          buildingData.indices.push(idx + indexOffset);
        }
        buildingData.positions.push(...boxData.positions);
        buildingData.normals.push(...boxData.normals);
        indexOffset += boxData.positions.length / 3;

        // Create invisible collision mesh
        const collider = MeshBuilder.CreateBox(
          `collider_${key}_${buildingCount}`,
          { width: bWidth, height: bHeight, depth: bDepth },
          this.scene
        );
        collider.position = new Vector3(bx, by, bz);
        collider.isVisible = false;
        collider.freezeWorldMatrix();
        createCollisionBox(collider, this.physicsManager);
        collisionMeshes.push(collider);

        buildingCount++;
        currentZ += bDepth + BUILDING_SPACING + random.range(5, 15);
      }

      currentX += random.range(MIN_BUILDING_WIDTH, MAX_BUILDING_WIDTH) + BUILDING_SPACING + random.range(5, 15);
    }

    // Create merged mesh from all buildings
    let mergedMesh: Mesh | null = null;

    if (buildingData.positions.length > 0) {
      mergedMesh = new Mesh(`chunk_${key}`, this.scene);

      const vertexData = new VertexData();
      vertexData.positions = buildingData.positions;
      vertexData.indices = buildingData.indices;
      vertexData.normals = buildingData.normals;
      vertexData.applyToMesh(mergedMesh);

      // Use a random shared material
      const matIndex = Math.abs(chunkX + chunkZ) % this.buildingMaterials.length;
      mergedMesh.material = this.buildingMaterials[matIndex];
      mergedMesh.receiveShadows = true;

      // Add to shadow generator (only the merged mesh)
      this.shadowGenerator.addShadowCaster(mergedMesh);

      mergedMesh.freezeWorldMatrix();
    }

    this.chunks.set(key, {
      key,
      chunkX,
      chunkZ,
      mergedMesh,
      collisionMeshes,
      lastAccess: performance.now(),
    });
  }

  /**
   * Creates vertex data for a box at a specific position
   */
  private createBoxVertexData(
    x: number, y: number, z: number,
    width: number, height: number, depth: number
  ): { positions: number[]; indices: number[]; normals: number[] } {
    const hw = width / 2;
    const hh = height / 2;
    const hd = depth / 2;

    // 8 vertices of the box
    const positions = [
      // Front face
      x - hw, y - hh, z + hd,
      x + hw, y - hh, z + hd,
      x + hw, y + hh, z + hd,
      x - hw, y + hh, z + hd,
      // Back face
      x + hw, y - hh, z - hd,
      x - hw, y - hh, z - hd,
      x - hw, y + hh, z - hd,
      x + hw, y + hh, z - hd,
      // Top face
      x - hw, y + hh, z + hd,
      x + hw, y + hh, z + hd,
      x + hw, y + hh, z - hd,
      x - hw, y + hh, z - hd,
      // Bottom face
      x - hw, y - hh, z - hd,
      x + hw, y - hh, z - hd,
      x + hw, y - hh, z + hd,
      x - hw, y - hh, z + hd,
      // Right face
      x + hw, y - hh, z + hd,
      x + hw, y - hh, z - hd,
      x + hw, y + hh, z - hd,
      x + hw, y + hh, z + hd,
      // Left face
      x - hw, y - hh, z - hd,
      x - hw, y - hh, z + hd,
      x - hw, y + hh, z + hd,
      x - hw, y + hh, z - hd,
    ];

    const indices = [
      0, 1, 2, 0, 2, 3,       // Front
      4, 5, 6, 4, 6, 7,       // Back
      8, 9, 10, 8, 10, 11,    // Top
      12, 13, 14, 12, 14, 15, // Bottom
      16, 17, 18, 16, 18, 19, // Right
      20, 21, 22, 20, 22, 23, // Left
    ];

    const normals = [
      // Front
      0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1,
      // Back
      0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1,
      // Top
      0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0,
      // Bottom
      0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0,
      // Right
      1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0,
      // Left
      -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0,
    ];

    return { positions, indices, normals };
  }

  /**
   * Unloads a chunk
   */
  private unloadChunk(key: string): void {
    const chunk = this.chunks.get(key);
    if (!chunk) return;

    // Dispose merged mesh
    if (chunk.mergedMesh) {
      this.shadowGenerator.removeShadowCaster(chunk.mergedMesh);
      chunk.mergedMesh.dispose();
    }

    // Dispose collision meshes
    for (const mesh of chunk.collisionMeshes) {
      this.physicsManager.removeCollisionMesh(mesh);
      mesh.dispose();
    }

    this.chunks.delete(key);
  }

  /**
   * Hash function for chunk seeds
   */
  private hashCoords(x: number, z: number): number {
    const h = (x * 374761393 + z * 668265263 + this.baseSeed) ^ (x * 1274126177);
    return Math.abs(h);
  }

  /**
   * Gets spawn position
   */
  public getSpawnPosition(): Vector3 {
    return new Vector3(CHUNK_SIZE / 2, 1.0, CHUNK_SIZE / 2);
  }

  /**
   * Gets buildings for collision checking
   */
  public getBuildings(): Mesh[] {
    const buildings: Mesh[] = [];
    for (const chunk of this.chunks.values()) {
      if (chunk.mergedMesh) {
        buildings.push(chunk.mergedMesh);
      }
    }
    return buildings;
  }

  /**
   * Gets random rooftop position
   */
  public getRandomRooftopPosition(): Vector3 {
    return new Vector3(CHUNK_SIZE / 2, 50, CHUNK_SIZE / 2);
  }

  /**
   * Checks if position is inside building
   */
  public isPositionInsideBuilding(pos: Vector3, radius: number = 1): boolean {
    for (const chunk of this.chunks.values()) {
      for (const mesh of chunk.collisionMeshes) {
        if (mesh.name.startsWith('collider_')) {
          const bounds = mesh.getBoundingInfo().boundingBox;
          const min = bounds.minimumWorld;
          const max = bounds.maximumWorld;

          if (
            pos.x + radius > min.x && pos.x - radius < max.x &&
            pos.z + radius > min.z && pos.z - radius < max.z &&
            pos.y < max.y && pos.y > min.y - 2
          ) {
            return true;
          }
        }
      }
    }
    return false;
  }
}
