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
const LOAD_RADIUS = 2;
const UNLOAD_DISTANCE = 3;

// Building generation
const SIDEWALK_HEIGHT = 0.15;
const MIN_BUILDING_HEIGHT = 30;
const MAX_BUILDING_HEIGHT = 120;
const MIN_BUILDING_WIDTH = 12;
const MAX_BUILDING_WIDTH = 35;
const BUILDING_SPACING = 10;
const BUILDINGS_PER_CHUNK = 10; // More buildings for denser city

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
    // Generate a 3x3 grid of chunks around origin immediately
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        this.generateChunk(dx, dz);
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
          createCollisionBox(mesh, this.physicsManager);
          collisionMeshes.push(mesh);
        }

        buildingCount++;
        currentZ += bDepth + BUILDING_SPACING + random.range(8, 20);
      }

      currentX += random.range(MIN_BUILDING_WIDTH, MAX_BUILDING_WIDTH) + BUILDING_SPACING + random.range(8, 20);
    }

    this.chunks.set(key, {
      key,
      chunkX,
      chunkZ,
      mergedMesh: null,
      collisionMeshes,
      lastAccess: performance.now(),
    });
  }

  /**
   * Creates a building with varied architecture based on style
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

    switch (style) {
      case BuildingStyle.Tower: {
        // Tall thin tower with a wider base
        const baseHeight = height * 0.2;
        const towerHeight = height * 0.8;

        // Base section
        const base = MeshBuilder.CreateBox(
          `${baseName}_base`,
          { width: width, height: baseHeight, depth: depth },
          this.scene
        );
        base.position = new Vector3(x, baseHeight / 2 + SIDEWALK_HEIGHT, z);
        base.material = this.buildingMaterials[matIndex];
        base.receiveShadows = true;
        meshes.push(base);

        // Tower section (thinner)
        const tower = MeshBuilder.CreateBox(
          `${baseName}_main`,
          { width: width * 0.65, height: towerHeight, depth: depth * 0.65 },
          this.scene
        );
        tower.position = new Vector3(x, baseHeight + towerHeight / 2 + SIDEWALK_HEIGHT, z);
        tower.material = this.buildingMaterials[(matIndex + 1) % this.buildingMaterials.length];
        tower.receiveShadows = true;
        meshes.push(tower);
        break;
      }

      case BuildingStyle.Tiered: {
        // Stepped building with setbacks
        const numTiers = 2 + random.intRange(0, 2);
        const tierHeight = height / numTiers;
        let currentWidth = width;
        let currentDepth = depth;

        for (let t = 0; t < numTiers; t++) {
          const tier = MeshBuilder.CreateBox(
            `${baseName}_tier${t}${t === 0 ? '_main' : ''}`,
            { width: currentWidth, height: tierHeight, depth: currentDepth },
            this.scene
          );
          tier.position = new Vector3(
            x,
            t * tierHeight + tierHeight / 2 + SIDEWALK_HEIGHT,
            z
          );
          tier.material = this.buildingMaterials[(matIndex + t) % this.buildingMaterials.length];
          tier.receiveShadows = true;
          meshes.push(tier);

          currentWidth *= 0.75;
          currentDepth *= 0.75;
        }
        break;
      }

      case BuildingStyle.LShape: {
        // L-shaped building
        const wingHeight = height * (0.6 + random.next() * 0.3);

        // Main section
        const main = MeshBuilder.CreateBox(
          `${baseName}_main`,
          { width: width, height: height, depth: depth * 0.6 },
          this.scene
        );
        main.position = new Vector3(x, height / 2 + SIDEWALK_HEIGHT, z - depth * 0.2);
        main.material = this.buildingMaterials[matIndex];
        main.receiveShadows = true;
        meshes.push(main);

        // Wing section
        const wing = MeshBuilder.CreateBox(
          `${baseName}_wing`,
          { width: width * 0.5, height: wingHeight, depth: depth * 0.6 },
          this.scene
        );
        wing.position = new Vector3(
          x + width * 0.25,
          wingHeight / 2 + SIDEWALK_HEIGHT,
          z + depth * 0.2
        );
        wing.material = this.buildingMaterials[(matIndex + 1) % this.buildingMaterials.length];
        wing.receiveShadows = true;
        meshes.push(wing);
        break;
      }

      case BuildingStyle.Modern: {
        // Modern building with rooftop features
        const mainHeight = height * 0.9;

        // Main building
        const main = MeshBuilder.CreateBox(
          `${baseName}_main`,
          { width: width, height: mainHeight, depth: depth },
          this.scene
        );
        main.position = new Vector3(x, mainHeight / 2 + SIDEWALK_HEIGHT, z);
        main.material = this.buildingMaterials[matIndex];
        main.receiveShadows = true;
        meshes.push(main);

        // Rooftop structure
        const roofWidth = width * 0.4;
        const roofHeight = height * 0.15;
        const rooftop = MeshBuilder.CreateBox(
          `${baseName}_roof`,
          { width: roofWidth, height: roofHeight, depth: roofWidth },
          this.scene
        );
        rooftop.position = new Vector3(
          x + (random.next() - 0.5) * width * 0.3,
          mainHeight + roofHeight / 2 + SIDEWALK_HEIGHT,
          z + (random.next() - 0.5) * depth * 0.3
        );
        rooftop.material = this.rooftopMaterial;
        rooftop.receiveShadows = true;
        meshes.push(rooftop);
        break;
      }

      case BuildingStyle.Classic:
      default: {
        // Standard box building with window strips
        const main = MeshBuilder.CreateBox(
          `${baseName}_main`,
          { width: width, height: height, depth: depth },
          this.scene
        );
        main.position = new Vector3(x, height / 2 + SIDEWALK_HEIGHT, z);
        main.material = this.buildingMaterials[matIndex];
        main.receiveShadows = true;
        meshes.push(main);

        // Add horizontal window strip for visual interest
        if (height > 40) {
          const stripHeight = 2;
          const numStrips = Math.floor(height / 20);
          for (let s = 1; s <= numStrips && s <= 3; s++) {
            const strip = MeshBuilder.CreateBox(
              `${baseName}_strip${s}`,
              { width: width + 0.2, height: stripHeight, depth: depth + 0.2 },
              this.scene
            );
            strip.position = new Vector3(
              x,
              (height * s / (numStrips + 1)) + SIDEWALK_HEIGHT,
              z
            );
            strip.material = this.windowMaterial;
            strip.receiveShadows = true;
            meshes.push(strip);
          }
        }
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
    // Spawn on the road at the edge of chunk (0,0)
    // Buildings start at BUILDING_SPACING + 8 = 18, so x=5 is safe on the road
    return new Vector3(5, 1.0, CHUNK_SIZE / 2);
  }

  /**
   * Gets buildings for collision checking
   */
  public getBuildings(): Mesh[] {
    const buildings: Mesh[] = [];
    for (const chunk of this.chunks.values()) {
      for (const mesh of chunk.collisionMeshes) {
        if (mesh.name.startsWith('building_')) {
          buildings.push(mesh);
        }
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
