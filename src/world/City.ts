/**
 * Procedural Infinite City Generator
 * Creates city chunks dynamically as the player explores
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
const CHUNK_SIZE = 150; // Size of each city chunk in meters
const LOAD_RADIUS = 2; // Number of chunks to load around player
const UNLOAD_DISTANCE = 4; // Chunks further than this are unloaded

// Building generation
const STREET_WIDTH = 15;
const SIDEWALK_WIDTH = 3;
const SIDEWALK_HEIGHT = 0.15;

const MIN_BUILDING_HEIGHT = 20;
const MAX_BUILDING_HEIGHT = 100;
const MIN_BUILDING_WIDTH = 12;
const MAX_BUILDING_WIDTH = 25;
const BUILDING_SPACING = 8;

// Colors
const SIDEWALK_COLOR = new Color3(0.55, 0.55, 0.55);
const BUILDING_COLORS = [
  new Color3(0.7, 0.7, 0.75),
  new Color3(0.6, 0.55, 0.5),
  new Color3(0.5, 0.55, 0.6),
  new Color3(0.55, 0.45, 0.4),
  new Color3(0.75, 0.7, 0.65),
  new Color3(0.4, 0.45, 0.5),
  new Color3(0.65, 0.6, 0.55),
  new Color3(0.3, 0.35, 0.4),
];

const WINDOW_COLORS = [
  new Color3(1.0, 0.95, 0.7),
  new Color3(0.7, 0.85, 1.0),
  new Color3(0.9, 0.9, 0.8),
];

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

  public pick<T>(array: T[]): T {
    return array[Math.floor(this.next() * array.length)];
  }
}

/**
 * City chunk containing meshes and data for one area
 */
interface CityChunk {
  key: string;
  chunkX: number;
  chunkZ: number;
  meshes: Mesh[];
  lastAccess: number;
}

/**
 * Procedural city generator with infinite streaming
 */
export class City {
  private scene: Scene;
  private physicsManager: PhysicsManager;
  private shadowGenerator: ShadowGenerator;
  private baseSeed: number;

  private chunks: Map<string, CityChunk> = new Map();
  private groundMesh: Mesh | null = null;
  private groundMaterial: StandardMaterial;
  private sidewalkMaterial: StandardMaterial;
  private roadMaterial: StandardMaterial;

  private buildingIdCounter: number = 0;

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

    // Create shared materials
    this.groundMaterial = new StandardMaterial('groundMaterial', scene);
    this.groundMaterial.diffuseColor = new Color3(0.25, 0.35, 0.2);
    this.groundMaterial.specularColor = new Color3(0.05, 0.05, 0.05);

    this.sidewalkMaterial = new StandardMaterial('sidewalkMaterial', scene);
    this.sidewalkMaterial.diffuseColor = SIDEWALK_COLOR;
    this.sidewalkMaterial.specularColor = new Color3(0.1, 0.1, 0.1);

    this.roadMaterial = new StandardMaterial('roadMaterial', scene);
    this.roadMaterial.diffuseColor = new Color3(0.2, 0.2, 0.2);
    this.roadMaterial.specularColor = new Color3(0.05, 0.05, 0.05);

    // Create infinite ground
    this.createGround();

    // Generate initial chunks around origin
    this.updateChunks(new Vector3(0, 0, 0));
  }

  /**
   * Creates the infinite ground plane
   */
  private createGround(): void {
    const groundSize = 5000; // Very large ground

    this.groundMesh = MeshBuilder.CreateGround(
      'cityGround',
      { width: groundSize, height: groundSize },
      this.scene
    );
    this.groundMesh.position.y = 0;
    this.groundMesh.material = this.groundMaterial;
    this.groundMesh.receiveShadows = true;
    this.groundMesh.isPickable = true;
    createCollisionBox(this.groundMesh, this.physicsManager);
  }

  /**
   * Updates loaded chunks based on player position
   */
  public updateChunks(playerPosition: Vector3): void {
    const playerChunkX = Math.floor(playerPosition.x / CHUNK_SIZE);
    const playerChunkZ = Math.floor(playerPosition.z / CHUNK_SIZE);

    // Load chunks in radius around player
    for (let dx = -LOAD_RADIUS; dx <= LOAD_RADIUS; dx++) {
      for (let dz = -LOAD_RADIUS; dz <= LOAD_RADIUS; dz++) {
        const chunkX = playerChunkX + dx;
        const chunkZ = playerChunkZ + dz;
        const key = `${chunkX},${chunkZ}`;

        if (!this.chunks.has(key)) {
          this.generateChunk(chunkX, chunkZ);
        } else {
          // Update access time
          const chunk = this.chunks.get(key)!;
          chunk.lastAccess = performance.now();
        }
      }
    }

    // Unload distant chunks
    const now = performance.now();
    for (const [key, chunk] of this.chunks.entries()) {
      const dx = Math.abs(chunk.chunkX - playerChunkX);
      const dz = Math.abs(chunk.chunkZ - playerChunkZ);

      if (dx > UNLOAD_DISTANCE || dz > UNLOAD_DISTANCE) {
        // Only unload if not recently accessed
        if (now - chunk.lastAccess > 5000) {
          this.unloadChunk(key);
        }
      }
    }
  }

  /**
   * Generates a city chunk at the given chunk coordinates
   */
  private generateChunk(chunkX: number, chunkZ: number): void {
    const key = `${chunkX},${chunkZ}`;
    const chunkSeed = this.hashCoords(chunkX, chunkZ);
    const random = new SeededRandom(chunkSeed);

    const meshes: Mesh[] = [];
    const worldX = chunkX * CHUNK_SIZE;
    const worldZ = chunkZ * CHUNK_SIZE;

    // Create city block in this chunk
    const halfChunk = CHUNK_SIZE / 2;

    // Create sidewalk/platform for the chunk
    const sidewalk = this.createChunkSidewalk(worldX + halfChunk, worldZ + halfChunk, random);
    meshes.push(sidewalk);

    // Generate buildings
    const buildingMeshes = this.generateChunkBuildings(
      worldX + SIDEWALK_WIDTH,
      worldZ + SIDEWALK_WIDTH,
      CHUNK_SIZE - SIDEWALK_WIDTH * 2,
      CHUNK_SIZE - SIDEWALK_WIDTH * 2,
      random
    );
    meshes.push(...buildingMeshes);

    // Create road markings at chunk edges
    const markings = this.createChunkRoadMarkings(worldX, worldZ, random);
    meshes.push(...markings);

    this.chunks.set(key, {
      key,
      chunkX,
      chunkZ,
      meshes,
      lastAccess: performance.now(),
    });
  }

  /**
   * Creates sidewalk for a chunk
   */
  private createChunkSidewalk(centerX: number, centerZ: number, _random: SeededRandom): Mesh {
    const sidewalk = MeshBuilder.CreateBox(
      `sidewalk_${centerX}_${centerZ}`,
      {
        width: CHUNK_SIZE - STREET_WIDTH,
        height: SIDEWALK_HEIGHT,
        depth: CHUNK_SIZE - STREET_WIDTH,
      },
      this.scene
    );

    sidewalk.position = new Vector3(centerX, SIDEWALK_HEIGHT / 2, centerZ);
    sidewalk.material = this.sidewalkMaterial;
    sidewalk.receiveShadows = true;
    createCollisionBox(sidewalk, this.physicsManager);

    return sidewalk;
  }

  /**
   * Generates buildings within a chunk area
   */
  private generateChunkBuildings(
    startX: number,
    startZ: number,
    width: number,
    depth: number,
    random: SeededRandom
  ): Mesh[] {
    const meshes: Mesh[] = [];
    const endX = startX + width;
    const endZ = startZ + depth;

    let currentX = startX + BUILDING_SPACING;

    while (currentX < endX - MIN_BUILDING_WIDTH) {
      let currentZ = startZ + BUILDING_SPACING;

      while (currentZ < endZ - MIN_BUILDING_WIDTH) {
        const maxWidth = Math.min(MAX_BUILDING_WIDTH, endX - currentX - BUILDING_SPACING);
        const maxDepth = Math.min(MAX_BUILDING_WIDTH, endZ - currentZ - BUILDING_SPACING);

        if (maxWidth < MIN_BUILDING_WIDTH || maxDepth < MIN_BUILDING_WIDTH) {
          currentZ += BUILDING_SPACING;
          continue;
        }

        const bWidth = random.range(MIN_BUILDING_WIDTH, maxWidth);
        const bDepth = random.range(MIN_BUILDING_WIDTH, maxDepth);
        const bHeight = random.range(MIN_BUILDING_HEIGHT, MAX_BUILDING_HEIGHT);

        const buildingMeshes = this.createBuilding(
          currentX + bWidth / 2,
          currentZ + bDepth / 2,
          bWidth,
          bHeight,
          bDepth,
          random
        );
        meshes.push(...buildingMeshes);

        currentZ += bDepth + BUILDING_SPACING + random.range(0, 5);
      }

      currentX += random.range(MIN_BUILDING_WIDTH, MAX_BUILDING_WIDTH) + BUILDING_SPACING;
    }

    return meshes;
  }

  /**
   * Creates a building with variations
   */
  private createBuilding(
    x: number,
    z: number,
    width: number,
    height: number,
    depth: number,
    random: SeededRandom
  ): Mesh[] {
    const meshes: Mesh[] = [];
    const buildingId = this.buildingIdCounter++;
    const buildingType = random.intRange(0, 10);

    if (buildingType < 3 && height > 60) {
      // Tiered building
      meshes.push(...this.createTieredBuilding(x, z, width, height, depth, buildingId, random));
    } else if (buildingType < 5 && width > 15 && depth > 15) {
      // L-shaped building
      meshes.push(...this.createLShapedBuilding(x, z, width, height, depth, buildingId, random));
    } else {
      // Standard building
      meshes.push(...this.createStandardBuilding(x, z, width, height, depth, buildingId, random));
    }

    return meshes;
  }

  /**
   * Creates a standard box building
   */
  private createStandardBuilding(
    x: number,
    z: number,
    width: number,
    height: number,
    depth: number,
    buildingId: number,
    random: SeededRandom
  ): Mesh[] {
    const meshes: Mesh[] = [];

    const building = MeshBuilder.CreateBox(
      `building_${buildingId}`,
      { width, height, depth },
      this.scene
    );

    building.position = new Vector3(x, height / 2 + SIDEWALK_HEIGHT, z);

    const baseColor = random.pick(BUILDING_COLORS);
    const material = new StandardMaterial(`buildingMat_${buildingId}`, this.scene);
    material.diffuseColor = baseColor;
    material.specularColor = new Color3(0.15, 0.15, 0.15);
    building.material = material;

    building.receiveShadows = true;
    this.shadowGenerator.addShadowCaster(building);
    createCollisionBox(building, this.physicsManager);
    meshes.push(building);

    // Add windows
    meshes.push(...this.addBuildingWindows(x, z, width, height, depth, buildingId, random));

    // Add rooftop for taller buildings
    if (height > 40) {
      meshes.push(...this.addRooftopDetails(x, z, width, height, depth, buildingId, random));
    }

    return meshes;
  }

  /**
   * Creates a tiered building
   */
  private createTieredBuilding(
    x: number,
    z: number,
    width: number,
    height: number,
    depth: number,
    buildingId: number,
    random: SeededRandom
  ): Mesh[] {
    const meshes: Mesh[] = [];
    const numTiers = random.intRange(2, 4);
    const tierHeight = height / numTiers;
    const baseColor = random.pick(BUILDING_COLORS);

    const material = new StandardMaterial(`buildingMat_${buildingId}`, this.scene);
    material.diffuseColor = baseColor;
    material.specularColor = new Color3(0.15, 0.15, 0.15);

    for (let i = 0; i < numTiers; i++) {
      const tierScale = 1 - i * 0.15;
      const tierWidth = width * tierScale;
      const tierDepth = depth * tierScale;
      const tierY = tierHeight / 2 + SIDEWALK_HEIGHT + i * tierHeight;

      const tier = MeshBuilder.CreateBox(
        `building_${buildingId}_tier${i}`,
        { width: tierWidth, height: tierHeight, depth: tierDepth },
        this.scene
      );

      tier.position = new Vector3(x, tierY, z);
      tier.material = material;
      tier.receiveShadows = true;
      this.shadowGenerator.addShadowCaster(tier);
      createCollisionBox(tier, this.physicsManager);
      meshes.push(tier);
    }

    meshes.push(...this.addBuildingWindows(x, z, width * 0.85, height * 0.7, depth * 0.85, buildingId, random));

    return meshes;
  }

  /**
   * Creates an L-shaped building
   */
  private createLShapedBuilding(
    x: number,
    z: number,
    width: number,
    height: number,
    depth: number,
    buildingId: number,
    random: SeededRandom
  ): Mesh[] {
    const meshes: Mesh[] = [];
    const baseColor = random.pick(BUILDING_COLORS);

    const material = new StandardMaterial(`buildingMat_${buildingId}`, this.scene);
    material.diffuseColor = baseColor;
    material.specularColor = new Color3(0.15, 0.15, 0.15);

    // Main section
    const mainWidth = width * 0.6;
    const main = MeshBuilder.CreateBox(
      `building_${buildingId}_main`,
      { width: mainWidth, height, depth },
      this.scene
    );
    main.position = new Vector3(x - (width - mainWidth) / 2, height / 2 + SIDEWALK_HEIGHT, z);
    main.material = material;
    main.receiveShadows = true;
    this.shadowGenerator.addShadowCaster(main);
    createCollisionBox(main, this.physicsManager);
    meshes.push(main);

    // Wing section
    const wingDepth = depth * 0.5;
    const wingHeight = height * 0.8;
    const wing = MeshBuilder.CreateBox(
      `building_${buildingId}_wing`,
      { width: width * 0.5, height: wingHeight, depth: wingDepth },
      this.scene
    );
    wing.position = new Vector3(
      x + mainWidth / 2,
      wingHeight / 2 + SIDEWALK_HEIGHT,
      z - (depth - wingDepth) / 2
    );
    wing.material = material;
    wing.receiveShadows = true;
    this.shadowGenerator.addShadowCaster(wing);
    createCollisionBox(wing, this.physicsManager);
    meshes.push(wing);

    meshes.push(...this.addBuildingWindows(x, z, width, height, depth, buildingId, random));

    return meshes;
  }

  /**
   * Adds window strips to a building
   */
  private addBuildingWindows(
    x: number,
    z: number,
    width: number,
    height: number,
    depth: number,
    buildingId: number,
    random: SeededRandom
  ): Mesh[] {
    const meshes: Mesh[] = [];
    const windowSize = 1.5;
    const windowSpacingV = 4;
    const windowInset = 0.1;

    const windowMaterial = new StandardMaterial(`windowMat_${buildingId}`, this.scene);
    const windowColor = random.pick(WINDOW_COLORS);
    windowMaterial.diffuseColor = windowColor.scale(0.3);
    windowMaterial.emissiveColor = windowColor.scale(0.4);
    windowMaterial.specularColor = new Color3(0.5, 0.5, 0.5);

    const numWindowsH = Math.floor((width - 4) / 4);
    const numWindowsV = Math.floor((height - 4) / windowSpacingV);

    if (numWindowsH < 1 || numWindowsV < 1) return meshes;

    const stripWidth = Math.max(width - 4, windowSize);

    // Front windows
    for (let row = 0; row < numWindowsV; row++) {
      if (random.next() > 0.85) continue;

      const windowStrip = MeshBuilder.CreateBox(
        `window_${buildingId}_front_${row}`,
        { width: stripWidth, height: windowSize, depth: windowInset },
        this.scene
      );

      const windowY = SIDEWALK_HEIGHT + 3 + row * windowSpacingV;
      windowStrip.position = new Vector3(x, windowY, z + depth / 2 + windowInset / 2);
      windowStrip.material = windowMaterial;
      meshes.push(windowStrip);
    }

    // Back windows
    for (let row = 0; row < numWindowsV; row++) {
      if (random.next() > 0.85) continue;

      const windowStrip = MeshBuilder.CreateBox(
        `window_${buildingId}_back_${row}`,
        { width: stripWidth, height: windowSize, depth: windowInset },
        this.scene
      );

      const windowY = SIDEWALK_HEIGHT + 3 + row * windowSpacingV;
      windowStrip.position = new Vector3(x, windowY, z - depth / 2 - windowInset / 2);
      windowStrip.material = windowMaterial;
      meshes.push(windowStrip);
    }

    return meshes;
  }

  /**
   * Adds rooftop structures
   */
  private addRooftopDetails(
    x: number,
    _z: number,
    width: number,
    height: number,
    depth: number,
    buildingId: number,
    random: SeededRandom
  ): Mesh[] {
    const meshes: Mesh[] = [];

    const rooftopWidth = width * 0.3;
    const rooftopDepth = depth * 0.3;
    const rooftopHeight = random.range(3, 6);

    const rooftop = MeshBuilder.CreateBox(
      `rooftop_${buildingId}`,
      { width: rooftopWidth, height: rooftopHeight, depth: rooftopDepth },
      this.scene
    );

    rooftop.position = new Vector3(x, height + SIDEWALK_HEIGHT + rooftopHeight / 2, _z);

    const material = new StandardMaterial(`rooftopMat_${buildingId}`, this.scene);
    material.diffuseColor = new Color3(0.35, 0.35, 0.35);
    rooftop.material = material;

    this.shadowGenerator.addShadowCaster(rooftop);
    createCollisionBox(rooftop, this.physicsManager);
    meshes.push(rooftop);

    return meshes;
  }

  /**
   * Creates road markings at chunk edges
   */
  private createChunkRoadMarkings(worldX: number, worldZ: number, _random: SeededRandom): Mesh[] {
    const meshes: Mesh[] = [];

    const markingMaterial = new StandardMaterial(`marking_${worldX}_${worldZ}`, this.scene);
    markingMaterial.diffuseColor = new Color3(1, 1, 0.7);
    markingMaterial.emissiveColor = new Color3(0.2, 0.2, 0.05);

    // Crosswalk at chunk corner
    const crosswalk = MeshBuilder.CreateBox(
      `crosswalk_${worldX}_${worldZ}`,
      { width: STREET_WIDTH - 2, height: 0.02, depth: 2 },
      this.scene
    );
    crosswalk.position = new Vector3(worldX, 0.01, worldZ);
    crosswalk.material = markingMaterial;
    meshes.push(crosswalk);

    return meshes;
  }

  /**
   * Unloads a chunk and disposes its meshes
   */
  private unloadChunk(key: string): void {
    const chunk = this.chunks.get(key);
    if (!chunk) return;

    for (const mesh of chunk.meshes) {
      this.physicsManager.removeCollisionMesh(mesh);
      mesh.dispose();
    }

    this.chunks.delete(key);
  }

  /**
   * Hash function for deterministic chunk seeds
   */
  private hashCoords(x: number, z: number): number {
    const h = (x * 374761393 + z * 668265263 + this.baseSeed) ^ (x * 1274126177);
    return Math.abs(h);
  }

  /**
   * Gets all currently loaded building meshes
   */
  public getBuildings(): Mesh[] {
    const buildings: Mesh[] = [];
    for (const chunk of this.chunks.values()) {
      for (const mesh of chunk.meshes) {
        if (mesh.name.startsWith('building_')) {
          buildings.push(mesh);
        }
      }
    }
    return buildings;
  }

  /**
   * Gets spawn position near origin
   */
  public getSpawnPosition(): Vector3 {
    return new Vector3(CHUNK_SIZE / 2, 1.0, CHUNK_SIZE / 2);
  }

  /**
   * Gets a position on a random building rooftop
   */
  public getRandomRooftopPosition(): Vector3 {
    const buildings = this.getBuildings();
    if (buildings.length === 0) {
      return new Vector3(0, 20, 0);
    }

    const building = buildings[Math.floor(Math.random() * buildings.length)];
    const bounds = building.getBoundingInfo().boundingBox;

    return new Vector3(
      building.position.x,
      bounds.maximumWorld.y + 2,
      building.position.z
    );
  }

  /**
   * Checks if position is inside any building
   */
  public isPositionInsideBuilding(pos: Vector3, radius: number = 1): boolean {
    for (const chunk of this.chunks.values()) {
      for (const mesh of chunk.meshes) {
        if (!mesh.name.startsWith('building_')) continue;

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
    return false;
  }
}
