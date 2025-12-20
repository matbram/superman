/**
 * Optimized Procedural Infinite City Generator
 * Uses varied building shapes, shared materials, and throttled generation for performance
 */

import { Scene } from '@babylonjs/core/scene';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { ShadowGenerator } from '@babylonjs/core/Lights/Shadows/shadowGenerator';
import { PhysicsManager, createCollisionBox } from '../physics/physics';

// Chunk and city generation constants
const CHUNK_SIZE = 200; // Larger chunks = fewer total chunks
const LOAD_RADIUS = 2;  // Reduced: 5x5=25 chunks instead of 7x7=49
const UNLOAD_DISTANCE = 3;  // Unload chunks sooner
const CHUNKS_PER_FRAME = 1;  // Generate 1 chunk per frame to avoid stutters

// LOD culling constants
const LOD_FADE_START_DISTANCE = 1;  // Start fading buildings at chunk distance 1
const LOD_FADE_END_DISTANCE = 2;    // Fully faded at chunk distance 2
const LOD_MIN_VISIBILITY = 0.3;     // Minimum visibility for distant buildings

// Performance logging
const ENABLE_CITY_PERF_LOGGING = true;
const CITY_PERF_LOG_INTERVAL = 2000;  // Log every 2 seconds

// Building generation - optimized for performance
const SIDEWALK_HEIGHT = 0.15;
const MIN_BUILDING_HEIGHT = 40;
const MAX_BUILDING_HEIGHT = 120;
const MIN_BUILDING_WIDTH = 12;
const MAX_BUILDING_WIDTH = 28;
const BUILDING_SPACING = 5;
const BUILDINGS_PER_CHUNK = 12; // Reduced for performance (was 24)

// Building style types
enum BuildingStyle {
  Tower = 0,      // Tall thin building
  Tiered = 1,     // Stepped building with setbacks
  LShape = 2,     // L-shaped footprint
  Modern = 3,     // Modern with rooftop features
  Classic = 4,    // Standard box building
}

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
  buildingMeshes: Mesh[];  // Cached reference to just buildings
  lastAccess: number;
  fadeProgress: number;  // 0 to 1, for smooth fade-in
  fullyVisible: boolean;
  currentLodVisibility: number;  // Cache current LOD level to avoid updates
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

  // Performance tracking
  private lastPerfLogTime: number = 0;
  private totalUpdateTime: number = 0;
  private updateCount: number = 0;
  private chunksGeneratedSinceLog: number = 0;

  // Shared materials - reused across all buildings
  private buildingMaterials: StandardMaterial[] = [];
  private sidewalkMaterial!: StandardMaterial;
  private groundMaterial!: StandardMaterial;
  private rooftopMaterial!: StandardMaterial;
  private windowMaterial!: StandardMaterial;

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

    // Generate initial chunks immediately (not throttled) for spawn area
    this.generateInitialChunks();
  }

  /**
   * Generates initial chunks around spawn point synchronously
   */
  private generateInitialChunks(): void {
    // Generate a 3x3 grid of chunks around origin immediately for seamless start
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        this.generateChunk(dx, dz);

        // Make initial chunks fully visible immediately (no fade-in)
        const key = `${dx},${dz}`;
        const chunk = this.chunks.get(key);
        if (chunk) {
          chunk.fadeProgress = 1;
          chunk.fullyVisible = true;
          chunk.currentLodVisibility = 1;
          // Set all buildings to fully visible using cached array
          for (const mesh of chunk.buildingMeshes) {
            mesh.visibility = 1;
          }
        }
      }
    }
  }

  /**
   * Creates all shared materials upfront
   */
  private createSharedMaterials(): void {
    // Building materials - varied concrete/steel colors
    const colors = [
      new Color3(0.65, 0.65, 0.7),   // Light gray
      new Color3(0.55, 0.5, 0.48),   // Warm gray
      new Color3(0.48, 0.52, 0.56),  // Blue gray
      new Color3(0.6, 0.55, 0.5),    // Tan gray
      new Color3(0.4, 0.42, 0.45),   // Dark steel
      new Color3(0.7, 0.68, 0.65),   // Light concrete
      new Color3(0.35, 0.32, 0.3),   // Dark concrete
      new Color3(0.5, 0.45, 0.4),    // Brown stone
    ];

    for (let i = 0; i < colors.length; i++) {
      const mat = new StandardMaterial(`buildingMat_${i}`, this.scene);
      mat.diffuseColor = colors[i];
      mat.specularColor = new Color3(0.15, 0.15, 0.15);
      mat.freeze();
      this.buildingMaterials.push(mat);
    }

    // Sidewalk material
    this.sidewalkMaterial = new StandardMaterial('sidewalkMat', this.scene);
    this.sidewalkMaterial.diffuseColor = new Color3(0.5, 0.5, 0.5);
    this.sidewalkMaterial.specularColor = new Color3(0.05, 0.05, 0.05);
    this.sidewalkMaterial.freeze();

    // Ground material (asphalt/road)
    this.groundMaterial = new StandardMaterial('groundMat', this.scene);
    this.groundMaterial.diffuseColor = new Color3(0.2, 0.2, 0.22);
    this.groundMaterial.specularColor = new Color3(0.02, 0.02, 0.02);
    this.groundMaterial.freeze();

    // Rooftop material (darker)
    this.rooftopMaterial = new StandardMaterial('rooftopMat', this.scene);
    this.rooftopMaterial.diffuseColor = new Color3(0.25, 0.25, 0.28);
    this.rooftopMaterial.specularColor = new Color3(0.05, 0.05, 0.05);
    this.rooftopMaterial.freeze();

    // Window strip material (dark reflective)
    this.windowMaterial = new StandardMaterial('windowMat', this.scene);
    this.windowMaterial.diffuseColor = new Color3(0.15, 0.18, 0.22);
    this.windowMaterial.specularColor = new Color3(0.4, 0.4, 0.5);
    this.windowMaterial.emissiveColor = new Color3(0.05, 0.08, 0.1);
    this.windowMaterial.freeze();
  }

  /**
   * Creates a fallback ground plane (larger, for areas without chunks)
   * Note: Each chunk now has its own ground, this is just a safety fallback
   */
  private createGround(): void {
    // Create a large fallback ground that's slightly below chunk grounds
    this.groundMesh = MeshBuilder.CreateGround(
      'fallbackGround',
      { width: 6000, height: 6000 },
      this.scene
    );
    this.groundMesh.position.y = -0.1; // Slightly below chunk grounds

    const fallbackMat = new StandardMaterial('fallbackGroundMat', this.scene);
    fallbackMat.diffuseColor = new Color3(0.15, 0.18, 0.12);
    fallbackMat.specularColor = new Color3(0.01, 0.01, 0.01);
    fallbackMat.freeze();

    this.groundMesh.material = fallbackMat;
    this.groundMesh.receiveShadows = true;
    this.groundMesh.isPickable = true;
    this.groundMesh.freezeWorldMatrix();
    createCollisionBox(this.groundMesh, this.physicsManager);
  }

  /**
   * Updates loaded chunks - with throttled generation and fade-in
   */
  public updateChunks(playerPosition: Vector3): void {
    const updateStart = performance.now();
    const playerChunkX = Math.floor(playerPosition.x / CHUNK_SIZE);
    const playerChunkZ = Math.floor(playerPosition.z / CHUNK_SIZE);

    // Queue chunks that need loading - load further out for seamless experience
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

    // Generate multiple pending chunks per frame for faster loading
    if (this.pendingChunks.length > 0) {
      // Sort by distance to player (generate closest first)
      this.pendingChunks.sort((a, b) => {
        const distA = Math.abs(a.chunkX - playerChunkX) + Math.abs(a.chunkZ - playerChunkZ);
        const distB = Math.abs(b.chunkX - playerChunkX) + Math.abs(b.chunkZ - playerChunkZ);
        return distA - distB;
      });

      // Generate multiple chunks per frame to stay ahead of the player
      const chunksToGenerate = Math.min(CHUNKS_PER_FRAME, this.pendingChunks.length);
      for (let i = 0; i < chunksToGenerate; i++) {
        const next = this.pendingChunks.shift()!;
        this.generateChunk(next.chunkX, next.chunkZ);
        this.chunksGeneratedSinceLog++;
      }
    }

    // Update fade-in for chunks, apply LOD culling, and unload distant ones
    const now = performance.now();
    for (const [key, chunk] of this.chunks.entries()) {
      const dx = Math.abs(chunk.chunkX - playerChunkX);
      const dz = Math.abs(chunk.chunkZ - playerChunkZ);
      const chunkDistance = Math.max(dx, dz);

      // Calculate LOD visibility based on distance (smooth fade from 1.0 to LOD_MIN_VISIBILITY)
      let lodVisibility = 1.0;
      if (chunkDistance >= LOD_FADE_END_DISTANCE) {
        lodVisibility = LOD_MIN_VISIBILITY;
      } else if (chunkDistance >= LOD_FADE_START_DISTANCE) {
        const fadeRange = LOD_FADE_END_DISTANCE - LOD_FADE_START_DISTANCE;
        const fadeProgress = (chunkDistance - LOD_FADE_START_DISTANCE) / fadeRange;
        lodVisibility = 1.0 - (fadeProgress * (1.0 - LOD_MIN_VISIBILITY));
      }

      // Handle fade-in for new chunks
      if (!chunk.fullyVisible) {
        chunk.fadeProgress = Math.min(1, chunk.fadeProgress + 0.05);  // Faster fade-in
        const targetVisibility = chunk.fadeProgress * lodVisibility;

        // Update building visibility during fade-in
        for (const mesh of chunk.buildingMeshes) {
          mesh.visibility = targetVisibility;
        }

        if (chunk.fadeProgress >= 1) {
          chunk.fullyVisible = true;
          chunk.currentLodVisibility = lodVisibility;
        }
      } else if (Math.abs(chunk.currentLodVisibility - lodVisibility) > 0.05) {
        // Only update visibility if LOD level changed significantly
        chunk.currentLodVisibility = lodVisibility;
        for (const mesh of chunk.buildingMeshes) {
          mesh.visibility = lodVisibility;
        }
      }

      // Unload distant chunks
      if (dx > UNLOAD_DISTANCE || dz > UNLOAD_DISTANCE) {
        if (now - chunk.lastAccess > 2000) {
          this.unloadChunk(key);
        }
      }
    }

    // Performance logging
    if (ENABLE_CITY_PERF_LOGGING) {
      const updateEnd = performance.now();
      this.totalUpdateTime += updateEnd - updateStart;
      this.updateCount++;

      if (now - this.lastPerfLogTime > CITY_PERF_LOG_INTERVAL) {
        const avgUpdateTime = this.totalUpdateTime / this.updateCount;
        let totalMeshes = 0;
        let totalBuildings = 0;
        for (const chunk of this.chunks.values()) {
          totalMeshes += chunk.collisionMeshes.length;
          totalBuildings += chunk.collisionMeshes.filter(m => m.name.startsWith('building_')).length;
        }
        console.log('[City Perf]', {
          avgUpdateTime: avgUpdateTime.toFixed(2) + 'ms',
          loadedChunks: this.chunks.size,
          pendingChunks: this.pendingChunks.length,
          totalMeshes,
          totalBuildings,
          chunksGenerated: this.chunksGeneratedSinceLog,
        });
        this.lastPerfLogTime = now;
        this.updateCount = 0;
        this.totalUpdateTime = 0;
        this.chunksGeneratedSinceLog = 0;
      }
    }
  }

  /**
   * Generates a city chunk with varied building shapes and ground
   */
  private generateChunk(chunkX: number, chunkZ: number): void {
    const key = `${chunkX},${chunkZ}`;
    if (this.chunks.has(key)) return; // Already exists

    const chunkSeed = this.hashCoords(chunkX, chunkZ);
    const random = new SeededRandom(chunkSeed);

    const worldX = chunkX * CHUNK_SIZE;
    const worldZ = chunkZ * CHUNK_SIZE;
    const halfChunk = CHUNK_SIZE / 2;

    const collisionMeshes: Mesh[] = [];

    // Create chunk ground (asphalt/road)
    const chunkGround = MeshBuilder.CreateGround(
      `ground_${key}`,
      { width: CHUNK_SIZE, height: CHUNK_SIZE },
      this.scene
    );
    chunkGround.position = new Vector3(worldX + halfChunk, 0, worldZ + halfChunk);
    chunkGround.material = this.groundMaterial;
    chunkGround.receiveShadows = true;
    chunkGround.isPickable = true;
    chunkGround.freezeWorldMatrix();  // Static - never moves
    createCollisionBox(chunkGround, this.physicsManager);
    collisionMeshes.push(chunkGround);

    // Create sidewalk (raised slightly)
    const sidewalk = MeshBuilder.CreateBox(
      `sidewalk_${key}`,
      { width: CHUNK_SIZE - 15, height: SIDEWALK_HEIGHT, depth: CHUNK_SIZE - 15 },
      this.scene
    );
    sidewalk.position = new Vector3(worldX + halfChunk, SIDEWALK_HEIGHT / 2, worldZ + halfChunk);
    sidewalk.material = this.sidewalkMaterial;
    sidewalk.receiveShadows = true;
    sidewalk.freezeWorldMatrix();  // Static - never moves
    createCollisionBox(sidewalk, this.physicsManager);
    collisionMeshes.push(sidewalk);

    // Generate buildings with varied styles
    let buildingCount = 0;
    let currentX = worldX + BUILDING_SPACING + 8;
    const endX = worldX + CHUNK_SIZE - BUILDING_SPACING - 8;
    const endZ = worldZ + CHUNK_SIZE - BUILDING_SPACING - 8;

    while (currentX < endX && buildingCount < BUILDINGS_PER_CHUNK) {
      let currentZ = worldZ + BUILDING_SPACING + 8;

      while (currentZ < endZ && buildingCount < BUILDINGS_PER_CHUNK) {
        const bWidth = random.range(MIN_BUILDING_WIDTH, MAX_BUILDING_WIDTH);
        const bDepth = random.range(MIN_BUILDING_WIDTH, MAX_BUILDING_WIDTH);
        const bHeight = random.range(MIN_BUILDING_HEIGHT, MAX_BUILDING_HEIGHT);

        const bx = currentX + bWidth / 2;
        const bz = currentZ + bDepth / 2;

        // Choose building style based on seed
        const style = random.intRange(0, 4) as BuildingStyle;
        const buildingMeshes = this.createBuilding(
          key, buildingCount, style,
          bx, bz, bWidth, bDepth, bHeight,
          random, chunkX, chunkZ
        );

        for (const mesh of buildingMeshes) {
          // Add to shadow caster (limit shadows for performance)
          if (buildingCount < 3 && mesh.name.includes('main')) {
            this.shadowGenerator.addShadowCaster(mesh);
          }
          // Start buildings invisible - they will fade in
          mesh.visibility = 0;
          createCollisionBox(mesh, this.physicsManager);
          collisionMeshes.push(mesh);
        }

        buildingCount++;
        currentZ += bDepth + BUILDING_SPACING + random.range(2, 8);
      }

      currentX += random.range(MIN_BUILDING_WIDTH, MAX_BUILDING_WIDTH) + BUILDING_SPACING + random.range(2, 8);
    }

    // Extract building meshes for efficient LOD updates
    const buildingMeshes = collisionMeshes.filter(m => m.name.startsWith('building_'));

    this.chunks.set(key, {
      key,
      chunkX,
      chunkZ,
      mergedMesh: null,
      collisionMeshes,
      buildingMeshes,
      lastAccess: performance.now(),
      fadeProgress: 0,
      fullyVisible: false,
      currentLodVisibility: 0,
    });
  }

  /**
   * Creates a building - simplified to single mesh for performance
   */
  private createBuilding(
    chunkKey: string,
    index: number,
    style: BuildingStyle,
    x: number, z: number,
    width: number, depth: number, height: number,
    random: SeededRandom,
    chunkX: number, chunkZ: number
  ): Mesh[] {
    const meshes: Mesh[] = [];
    const baseName = `building_${chunkKey}_${index}`;
    const matIndex = Math.abs(chunkX + chunkZ + index) % this.buildingMaterials.length;

    // All styles now create single mesh for performance (reduces draw calls by ~60%)
    // Visual variety comes from different heights, widths, and materials
    let finalWidth = width;
    let finalDepth = depth;
    let finalHeight = height;

    // Apply style-based size variations
    switch (style) {
      case BuildingStyle.Tower:
        // Taller and thinner
        finalWidth *= 0.7;
        finalDepth *= 0.7;
        finalHeight *= 1.2;
        break;
      case BuildingStyle.Tiered:
        // Wider base feel
        finalWidth *= 1.1;
        finalDepth *= 1.1;
        finalHeight *= 0.9;
        break;
      case BuildingStyle.LShape:
        // Slightly offset
        finalWidth *= 0.9;
        break;
      case BuildingStyle.Modern:
        // Standard proportions
        break;
      case BuildingStyle.Classic:
      default:
        // Standard box
        break;
    }

    const building = MeshBuilder.CreateBox(
      `${baseName}_main`,
      { width: finalWidth, height: finalHeight, depth: finalDepth },
      this.scene
    );
    building.position = new Vector3(x, finalHeight / 2 + SIDEWALK_HEIGHT, z);
    building.material = this.buildingMaterials[matIndex];
    building.receiveShadows = true;
    building.freezeWorldMatrix();  // Static mesh - freeze for performance
    meshes.push(building);

    return meshes;
  }

  /**
   * Unloads a chunk
   */
  private unloadChunk(key: string): void {
    const chunk = this.chunks.get(key);
    if (!chunk) return;

    // Dispose all meshes (buildings + sidewalk)
    for (const mesh of chunk.collisionMeshes) {
      // Remove from shadow caster if it was added
      if (mesh.name.startsWith('building_')) {
        this.shadowGenerator.removeShadowCaster(mesh);
      }
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
   * Gets spawn position - on the road at chunk edge, guaranteed not inside a building
   */
  public getSpawnPosition(): Vector3 {
    // Spawn on the road at the edge of chunk (0,0)
    // Buildings start at BUILDING_SPACING + 8 = 18, so x=5 is safe on the road
    return new Vector3(5, 1.0, CHUNK_SIZE / 2);
  }

  /**
   * Gets buildings for collision checking - uses cached building meshes
   */
  public getBuildings(): Mesh[] {
    const buildings: Mesh[] = [];
    for (const chunk of this.chunks.values()) {
      // Use cached buildingMeshes array instead of filtering every time
      for (const mesh of chunk.buildingMeshes) {
        buildings.push(mesh);
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
