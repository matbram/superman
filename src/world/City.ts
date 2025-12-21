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
const LOAD_RADIUS = 3;  // Increased slightly for better skyline visibility
const UNLOAD_DISTANCE = 4;  // Unload chunks when far
const CHUNKS_PER_FRAME = 1;  // Generate 1 chunk per frame to avoid stutters

// LOD culling constants
const LOD_FADE_START_DISTANCE = 2;  // Start fading buildings at chunk distance 2
const LOD_FADE_END_DISTANCE = 3;    // Fully faded at chunk distance 3
const LOD_MIN_VISIBILITY = 0.4;     // Minimum visibility for distant buildings

// Performance logging
const ENABLE_CITY_PERF_LOGGING = true;
const CITY_PERF_LOG_INTERVAL = 2000;  // Log every 2 seconds

// Street layout - realistic NYC grid (exported for Traffic system)
export const STREET_WIDTH = 20;          // Width of streets at chunk edges (realistic NYC)
export const CITY_CHUNK_SIZE = 200;      // Exported chunk size for traffic
const SIDEWALK_HEIGHT = 0.3;

// Default building generation - NYC-style dense city
const DEFAULT_MIN_BUILDING_HEIGHT = 50;   // ~25 stories minimum
const DEFAULT_MAX_BUILDING_HEIGHT = 250;  // ~125 stories for tall skyscrapers
const DEFAULT_MIN_BUILDING_WIDTH = 15;    // Realistic NYC building footprint
const DEFAULT_MAX_BUILDING_WIDTH = 40;    // Large office buildings
const DEFAULT_BUILDING_SPACING = 5;       // Space between buildings
const DEFAULT_BUILDINGS_PER_CHUNK = 16;   // Dense but performant

/**
 * World generation settings - can be adjusted at runtime
 */
export interface WorldSettings {
  buildingsPerChunk: number;       // 4-30: density of buildings
  minBuildingHeight: number;       // 20-100: shortest buildings
  maxBuildingHeight: number;       // 100-400: tallest skyscrapers
  minBuildingWidth: number;        // 10-30: building footprint min
  maxBuildingWidth: number;        // 20-60: building footprint max
  buildingSpacing: number;         // 2-15: gap between buildings
}

// Default world settings
const DEFAULT_WORLD_SETTINGS: WorldSettings = {
  buildingsPerChunk: DEFAULT_BUILDINGS_PER_CHUNK,
  minBuildingHeight: DEFAULT_MIN_BUILDING_HEIGHT,
  maxBuildingHeight: DEFAULT_MAX_BUILDING_HEIGHT,
  minBuildingWidth: DEFAULT_MIN_BUILDING_WIDTH,
  maxBuildingWidth: DEFAULT_MAX_BUILDING_WIDTH,
  buildingSpacing: DEFAULT_BUILDING_SPACING,
};

// Building zone - area where buildings can be placed (inside the streets)
const BUILDING_ZONE_START = STREET_WIDTH;  // Buildings start after street
const BUILDING_ZONE_END = CHUNK_SIZE - STREET_WIDTH;  // Buildings end before street

// Building style types - more variety
enum BuildingStyle {
  Tower = 0,        // Tall thin skyscraper
  Tiered = 1,       // Art deco with setbacks
  LShape = 2,       // L-shaped footprint
  Modern = 3,       // Glass tower
  Classic = 4,      // Standard office
  Spire = 5,        // Building with antenna/spire
  WideBase = 6,     // Wider at bottom, tapers up
  Twin = 7,         // Two towers connected
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

  // Runtime configurable settings
  private settings: WorldSettings = { ...DEFAULT_WORLD_SETTINGS };

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

    // Create chunk ground (asphalt/road) - covers the entire chunk
    const chunkGround = MeshBuilder.CreateGround(
      `ground_${key}`,
      { width: CHUNK_SIZE, height: CHUNK_SIZE },
      this.scene
    );
    chunkGround.position = new Vector3(worldX + halfChunk, 0, worldZ + halfChunk);
    chunkGround.material = this.groundMaterial;
    chunkGround.receiveShadows = true;
    chunkGround.isPickable = true;
    chunkGround.freezeWorldMatrix();
    createCollisionBox(chunkGround, this.physicsManager);
    collisionMeshes.push(chunkGround);

    // Create sidewalk block (raised area where buildings sit)
    // This is the area BETWEEN the streets on each side
    const sidewalkSize = BUILDING_ZONE_END - BUILDING_ZONE_START;
    const sidewalk = MeshBuilder.CreateBox(
      `sidewalk_${key}`,
      { width: sidewalkSize, height: SIDEWALK_HEIGHT, depth: sidewalkSize },
      this.scene
    );
    sidewalk.position = new Vector3(
      worldX + BUILDING_ZONE_START + sidewalkSize / 2,
      SIDEWALK_HEIGHT / 2,
      worldZ + BUILDING_ZONE_START + sidewalkSize / 2
    );
    sidewalk.material = this.sidewalkMaterial;
    sidewalk.receiveShadows = true;
    sidewalk.freezeWorldMatrix();
    createCollisionBox(sidewalk, this.physicsManager);
    collisionMeshes.push(sidewalk);

    // Generate buildings with varied styles - ONLY within the building zone
    let buildingCount = 0;
    let currentX = worldX + BUILDING_ZONE_START + this.settings.buildingSpacing;
    const endX = worldX + BUILDING_ZONE_END - this.settings.buildingSpacing;
    const endZ = worldZ + BUILDING_ZONE_END - this.settings.buildingSpacing;

    while (currentX < endX && buildingCount < this.settings.buildingsPerChunk) {
      let currentZ = worldZ + BUILDING_ZONE_START + this.settings.buildingSpacing;

      while (currentZ < endZ && buildingCount < this.settings.buildingsPerChunk) {
        const bWidth = random.range(this.settings.minBuildingWidth, this.settings.maxBuildingWidth);
        const bDepth = random.range(this.settings.minBuildingWidth, this.settings.maxBuildingWidth);
        const bHeight = random.range(this.settings.minBuildingHeight, this.settings.maxBuildingHeight);

        const bx = currentX + bWidth / 2;
        const bz = currentZ + bDepth / 2;

        // Choose building style based on seed
        const style = random.intRange(0, 7) as BuildingStyle;
        const buildingMeshes = this.createBuilding(
          key, buildingCount, style,
          bx, bz, bWidth, bDepth, bHeight,
          random, chunkX, chunkZ
        );

        for (const mesh of buildingMeshes) {
          // Add more buildings as shadow casters for realism
          // Limit to first 8 buildings per chunk for performance
          if (buildingCount < 8) {
            this.shadowGenerator.addShadowCaster(mesh);
          }
          // Start buildings invisible - they will fade in
          mesh.visibility = 0;
          createCollisionBox(mesh, this.physicsManager);
          collisionMeshes.push(mesh);
        }

        buildingCount++;
        currentZ += bDepth + this.settings.buildingSpacing + random.range(2, 8);
      }

      currentX += random.range(this.settings.minBuildingWidth, this.settings.maxBuildingWidth) + this.settings.buildingSpacing + random.range(2, 8);
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
   * Creates a building - NYC-style with varied proportions and complex shapes
   * Uses multiple meshes for interesting silhouettes while keeping performance reasonable
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
    const mat = this.buildingMaterials[matIndex];
    const mat2 = this.buildingMaterials[(matIndex + 1) % this.buildingMaterials.length];

    // Add random height variation for more natural skyline
    const heightVariation = 0.7 + random.next() * 0.6;
    height *= heightVariation;

    // Ensure minimum dimensions
    width = Math.max(width, 12);
    depth = Math.max(depth, 12);
    height = Math.max(height, 50);

    switch (style) {
      case BuildingStyle.Tower: {
        // Tall thin skyscraper with setback
        const baseH = height * 0.25;
        const towerH = height * 0.75;
        const towerW = width * 0.6;

        const base = MeshBuilder.CreateBox(`${baseName}_base`,
          { width, height: baseH, depth }, this.scene);
        base.position = new Vector3(x, baseH / 2 + SIDEWALK_HEIGHT, z);
        base.material = mat;
        base.receiveShadows = true;
        base.freezeWorldMatrix();
        meshes.push(base);

        const tower = MeshBuilder.CreateBox(`${baseName}_main`,
          { width: towerW, height: towerH, depth: towerW }, this.scene);
        tower.position = new Vector3(x, baseH + towerH / 2 + SIDEWALK_HEIGHT, z);
        tower.material = mat2;
        tower.receiveShadows = true;
        tower.freezeWorldMatrix();
        meshes.push(tower);
        break;
      }

      case BuildingStyle.Tiered: {
        // Art deco with 2-3 setbacks
        const tiers = 2 + Math.floor(random.next() * 2);
        let currentY = SIDEWALK_HEIGHT;
        let currentW = width;
        let currentD = depth;
        const tierH = height / tiers;

        for (let t = 0; t < tiers; t++) {
          const tier = MeshBuilder.CreateBox(`${baseName}_tier${t}${t === 0 ? '_main' : ''}`,
            { width: currentW, height: tierH, depth: currentD }, this.scene);
          tier.position = new Vector3(x, currentY + tierH / 2, z);
          tier.material = t % 2 === 0 ? mat : mat2;
          tier.receiveShadows = true;
          tier.freezeWorldMatrix();
          meshes.push(tier);

          currentY += tierH;
          currentW *= 0.75;
          currentD *= 0.75;
        }
        break;
      }

      case BuildingStyle.Spire: {
        // Building with antenna/spire on top
        const mainH = height * 0.85;
        const spireH = height * 0.25;

        const main = MeshBuilder.CreateBox(`${baseName}_main`,
          { width: width * 0.8, height: mainH, depth: depth * 0.8 }, this.scene);
        main.position = new Vector3(x, mainH / 2 + SIDEWALK_HEIGHT, z);
        main.material = mat;
        main.receiveShadows = true;
        main.freezeWorldMatrix();
        meshes.push(main);

        const spire = MeshBuilder.CreateBox(`${baseName}_spire`,
          { width: 3, height: spireH, depth: 3 }, this.scene);
        spire.position = new Vector3(x, mainH + spireH / 2 + SIDEWALK_HEIGHT, z);
        spire.material = this.rooftopMaterial;
        spire.receiveShadows = true;
        spire.freezeWorldMatrix();
        meshes.push(spire);
        break;
      }

      case BuildingStyle.WideBase: {
        // Pyramid-style wider at bottom
        const baseH = height * 0.4;
        const topH = height * 0.6;

        const base = MeshBuilder.CreateBox(`${baseName}_base`,
          { width: width * 1.2, height: baseH, depth: depth * 1.2 }, this.scene);
        base.position = new Vector3(x, baseH / 2 + SIDEWALK_HEIGHT, z);
        base.material = mat;
        base.receiveShadows = true;
        base.freezeWorldMatrix();
        meshes.push(base);

        const top = MeshBuilder.CreateBox(`${baseName}_main`,
          { width: width * 0.7, height: topH, depth: depth * 0.7 }, this.scene);
        top.position = new Vector3(x, baseH + topH / 2 + SIDEWALK_HEIGHT, z);
        top.material = mat2;
        top.receiveShadows = true;
        top.freezeWorldMatrix();
        meshes.push(top);
        break;
      }

      case BuildingStyle.Twin: {
        // Two towers side by side
        const towerW = width * 0.4;
        const gap = width * 0.1;

        const tower1 = MeshBuilder.CreateBox(`${baseName}_main`,
          { width: towerW, height: height, depth: depth * 0.8 }, this.scene);
        tower1.position = new Vector3(x - towerW / 2 - gap / 2, height / 2 + SIDEWALK_HEIGHT, z);
        tower1.material = mat;
        tower1.receiveShadows = true;
        tower1.freezeWorldMatrix();
        meshes.push(tower1);

        const tower2 = MeshBuilder.CreateBox(`${baseName}_twin`,
          { width: towerW, height: height * 0.9, depth: depth * 0.8 }, this.scene);
        tower2.position = new Vector3(x + towerW / 2 + gap / 2, (height * 0.9) / 2 + SIDEWALK_HEIGHT, z);
        tower2.material = mat2;
        tower2.receiveShadows = true;
        tower2.freezeWorldMatrix();
        meshes.push(tower2);
        break;
      }

      case BuildingStyle.LShape: {
        // L-shaped footprint
        const mainH = height;
        const wingH = height * (0.6 + random.next() * 0.3);

        const main = MeshBuilder.CreateBox(`${baseName}_main`,
          { width: width, height: mainH, depth: depth * 0.5 }, this.scene);
        main.position = new Vector3(x, mainH / 2 + SIDEWALK_HEIGHT, z - depth * 0.25);
        main.material = mat;
        main.receiveShadows = true;
        main.freezeWorldMatrix();
        meshes.push(main);

        const wing = MeshBuilder.CreateBox(`${baseName}_wing`,
          { width: width * 0.4, height: wingH, depth: depth * 0.5 }, this.scene);
        wing.position = new Vector3(x + width * 0.3, wingH / 2 + SIDEWALK_HEIGHT, z + depth * 0.25);
        wing.material = mat2;
        wing.receiveShadows = true;
        wing.freezeWorldMatrix();
        meshes.push(wing);
        break;
      }

      case BuildingStyle.Modern: {
        // Sleek modern glass tower
        const mainH = height * 1.3;
        const main = MeshBuilder.CreateBox(`${baseName}_main`,
          { width: width * 0.7, height: mainH, depth: depth * 0.7 }, this.scene);
        main.position = new Vector3(x, mainH / 2 + SIDEWALK_HEIGHT, z);
        main.material = this.windowMaterial;  // Glass-like
        main.receiveShadows = true;
        main.freezeWorldMatrix();
        meshes.push(main);
        break;
      }

      case BuildingStyle.Classic:
      default: {
        // Standard office building with rooftop
        const mainH = height * 0.95;
        const main = MeshBuilder.CreateBox(`${baseName}_main`,
          { width: width * 0.9, height: mainH, depth: depth * 0.9 }, this.scene);
        main.position = new Vector3(x, mainH / 2 + SIDEWALK_HEIGHT, z);
        main.material = mat;
        main.receiveShadows = true;
        main.freezeWorldMatrix();
        meshes.push(main);

        // Rooftop structure
        const roofH = height * 0.08;
        const roof = MeshBuilder.CreateBox(`${baseName}_roof`,
          { width: width * 0.4, height: roofH, depth: depth * 0.4 }, this.scene);
        roof.position = new Vector3(x, mainH + roofH / 2 + SIDEWALK_HEIGHT, z);
        roof.material = this.rooftopMaterial;
        roof.receiveShadows = true;
        roof.freezeWorldMatrix();
        meshes.push(roof);
        break;
      }
    }

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
    // Spawn in the middle of the street at the edge of chunk (0,0)
    // Streets are STREET_WIDTH (20m) wide at chunk edges
    return new Vector3(STREET_WIDTH / 2, 1.0, CHUNK_SIZE / 2);
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

  /**
   * Gets current world settings
   */
  public getSettings(): WorldSettings {
    return { ...this.settings };
  }

  /**
   * Updates world settings - changes take effect on newly generated chunks
   */
  public updateSettings(newSettings: Partial<WorldSettings>): void {
    this.settings = { ...this.settings, ...newSettings };
    console.log('[City] Settings updated:', this.settings);
  }

  /**
   * Regenerates the city with current settings
   * Clears all existing chunks and regenerates them
   */
  public regenerate(): void {
    console.log('[City] Regenerating city with new settings...');

    // Clear all existing chunks
    for (const chunk of this.chunks.values()) {
      this.unloadChunk(chunk.key);
    }
    this.pendingChunks = [];

    // Regenerate initial chunks
    this.generateInitialChunks();

    console.log('[City] City regenerated');
  }

  /**
   * Gets total building count across all chunks
   */
  public getBuildingCount(): number {
    let count = 0;
    for (const chunk of this.chunks.values()) {
      count += chunk.buildingMeshes.length;
    }
    return count;
  }

  /**
   * Gets loaded chunk count
   */
  public getChunkCount(): number {
    return this.chunks.size;
  }
}
