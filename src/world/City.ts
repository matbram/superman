/**
 * Optimized Procedural Infinite City Generator
 * Uses varied building shapes, shared materials, and throttled generation for performance
 */

import { Scene } from '@babylonjs/core/scene';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { Diag } from '../core/DiagnosticLog';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { ShadowGenerator } from '@babylonjs/core/Lights/Shadows/shadowGenerator';
import { PhysicsManager, createCollisionBox } from '../physics/physics';

// Chunk and city generation constants
const CHUNK_SIZE = 200;
const LOAD_RADIUS = 4;
const UNLOAD_DISTANCE = 5;
const CHUNKS_PER_FRAME = 2;

const ENABLE_CITY_PERF_LOGGING = false;
const CITY_PERF_LOG_INTERVAL = 2000;

// NYC-scale street grid (1 unit ≈ 1 meter)
// Real NYC: avenues are ~30m wide, cross streets ~18m wide
const AVENUE_WIDTH = 40;        // Wide avenues - Superman needs room to fly
const STREET_WIDTH = 24;        // Cross streets - wide enough for street-level flight
const SIDEWALK_HEIGHT = 0.15;
const BUILDING_GAP = 2;

// Manhattan-style blocks: LONG rectangles
// Real Manhattan blocks are ~80m x 270m
const BLOCK_WIDTH = 70;         // Short axis (between avenues)
const BLOCK_DEPTH_MIN = 120;    // Long axis minimum (between streets)
const BLOCK_DEPTH_MAX = 200;    // Long axis maximum

// Building sizes
const MIN_BUILDING_WIDTH = 15;
const MAX_BUILDING_WIDTH = 55;

// Building styles now chosen automatically based on lot size, height, and district

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
  fadeProgress: number;  // 0 to 1, for smooth fade-in
  fullyVisible: boolean;
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

    // Create landmark buildings (Daily Planet, monuments)
    this.createLandmarks();

    // Generate initial chunks immediately (not throttled) for spawn area
    this.generateInitialChunks();
  }

  /**
   * Generates initial chunks around spawn point synchronously
   */
  private generateInitialChunks(): void {
    // Generate a 5x5 grid of chunks around origin immediately for seamless start
    for (let dx = -2; dx <= 2; dx++) {
      for (let dz = -2; dz <= 2; dz++) {
        this.generateChunk(dx, dz);

        // Make initial chunks fully visible immediately (no fade-in)
        const key = `${dx},${dz}`;
        const chunk = this.chunks.get(key);
        if (chunk) {
          chunk.fadeProgress = 1;
          chunk.fullyVisible = true;
          // Set all buildings to fully visible
          for (const mesh of chunk.collisionMeshes) {
            if (mesh.name.startsWith('building_')) {
              mesh.visibility = 1;
            }
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

    // Window / glass material (dark reflective)
    this.windowMaterial = new StandardMaterial('windowMat', this.scene);
    this.windowMaterial.diffuseColor = new Color3(0.12, 0.16, 0.22);
    this.windowMaterial.specularColor = new Color3(0.5, 0.5, 0.6);
    this.windowMaterial.emissiveColor = new Color3(0.03, 0.06, 0.1);
    this.windowMaterial.freeze();

    // Glass tower material (dark reflective steel-blue, NO alpha - causes render artifacts)
    const glassMat = new StandardMaterial('glassMat', this.scene);
    glassMat.diffuseColor = new Color3(0.22, 0.28, 0.38);
    glassMat.specularColor = new Color3(0.5, 0.5, 0.6);
    glassMat.emissiveColor = new Color3(0.04, 0.06, 0.1);
    glassMat.freeze();
    this.buildingMaterials.push(glassMat);

    // Warm concrete
    const warmConcrete = new StandardMaterial('warmConcreteMat', this.scene);
    warmConcrete.diffuseColor = new Color3(0.72, 0.65, 0.55);
    warmConcrete.specularColor = new Color3(0.1, 0.1, 0.1);
    warmConcrete.freeze();
    this.buildingMaterials.push(warmConcrete);

    // Brick
    const brick = new StandardMaterial('brickMat', this.scene);
    brick.diffuseColor = new Color3(0.55, 0.3, 0.2);
    brick.specularColor = new Color3(0.08, 0.05, 0.05);
    brick.freeze();
    this.buildingMaterials.push(brick);

    // White modern
    const whiteMod = new StandardMaterial('whiteModMat', this.scene);
    whiteMod.diffuseColor = new Color3(0.85, 0.85, 0.88);
    whiteMod.specularColor = new Color3(0.2, 0.2, 0.2);
    whiteMod.freeze();
    this.buildingMaterials.push(whiteMod);
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
   * Creates iconic landmark buildings that are always present near the city center.
   */
  private createLandmarks(): void {
    // ── THE DAILY PLANET ──
    // Iconic building with a globe on top, near the spawn point
    const dpX = 50, dpZ = 80;
    const dpHeight = 180;
    const dpWidth = 35, dpDepth = 35;

    // Main building - Art Deco style (warm concrete)
    const dpMain = MeshBuilder.CreateBox('building_landmark_0_main', {
      width: dpWidth, height: dpHeight, depth: dpDepth
    }, this.scene);
    dpMain.position = new Vector3(dpX, dpHeight / 2 + SIDEWALK_HEIGHT, dpZ);
    dpMain.material = this.buildingMaterials[9]; // Warm concrete
    dpMain.receiveShadows = true;
    createCollisionBox(dpMain, this.physicsManager);
    this.shadowGenerator.addShadowCaster(dpMain);

    // Globe on top of the Daily Planet
    const globe = MeshBuilder.CreateSphere('dailyPlanetGlobe', {
      diameter: 18, segments: 16
    }, this.scene);
    globe.position = new Vector3(dpX, dpHeight + 12 + SIDEWALK_HEIGHT, dpZ);
    const globeMat = new StandardMaterial('globeMat', this.scene);
    globeMat.diffuseColor = new Color3(0.85, 0.75, 0.3);   // Gold
    globeMat.specularColor = new Color3(1.0, 0.9, 0.5);
    globeMat.emissiveColor = new Color3(0.15, 0.12, 0.02);  // Slight glow
    globeMat.freeze();
    globe.material = globeMat;
    globe.isPickable = false;

    // Globe ring (Saturn-like ring around the globe)
    const ring = MeshBuilder.CreateTorus('dailyPlanetRing', {
      diameter: 24, thickness: 1.5, tessellation: 24
    }, this.scene);
    ring.position = new Vector3(dpX, dpHeight + 12 + SIDEWALK_HEIGHT, dpZ);
    ring.rotation.x = Math.PI / 6; // Tilted
    ring.material = globeMat;
    ring.isPickable = false;

    // ── CITY HALL / GOVERNMENT BUILDING ──
    // Wide classical building with columns (represented as a wide low building)
    const chX = -60, chZ = 50;
    const chHeight = 40, chWidth = 60, chDepth = 40;
    const cityHall = MeshBuilder.CreateBox('building_landmark_1_main', {
      width: chWidth, height: chHeight, depth: chDepth
    }, this.scene);
    cityHall.position = new Vector3(chX, chHeight / 2 + SIDEWALK_HEIGHT, chZ);
    cityHall.material = this.buildingMaterials[11]; // White modern
    cityHall.receiveShadows = true;
    createCollisionBox(cityHall, this.physicsManager);

    // Dome on top of city hall
    const dome = MeshBuilder.CreateSphere('cityHallDome', {
      diameter: 20, segments: 12, slice: 0.5
    }, this.scene);
    dome.position = new Vector3(chX, chHeight + SIDEWALK_HEIGHT, chZ);
    dome.material = this.buildingMaterials[11];
    dome.isPickable = false;

    // ── METROPOLIS TOWER ──
    // Tallest building in the city, a massive glass skyscraper
    const mtX = 120, mtZ = 30;
    const mtHeight = 350;
    const mtWidth = 40, mtDepth = 40;
    const metroTower = MeshBuilder.CreateBox('building_landmark_2_main', {
      width: mtWidth, height: mtHeight, depth: mtDepth
    }, this.scene);
    metroTower.position = new Vector3(mtX, mtHeight / 2 + SIDEWALK_HEIGHT, mtZ);
    metroTower.material = this.buildingMaterials[8]; // Glass
    metroTower.receiveShadows = true;
    createCollisionBox(metroTower, this.physicsManager);
    this.shadowGenerator.addShadowCaster(metroTower);

    // Antenna/spire on top
    const spire = MeshBuilder.CreateCylinder('metroSpire', {
      diameter: 3, height: 40, tessellation: 8
    }, this.scene);
    spire.position = new Vector3(mtX, mtHeight + 20 + SIDEWALK_HEIGHT, mtZ);
    spire.material = this.rooftopMaterial;
    spire.isPickable = false;

    // ── CENTRAL PARK / PLAZA ──
    // A green area near center (just a colored ground patch)
    const parkGround = MeshBuilder.CreateGround('centralPark', {
      width: 100, height: 80
    }, this.scene);
    parkGround.position = new Vector3(0, SIDEWALK_HEIGHT + 0.05, 150);
    const parkMat = new StandardMaterial('parkMat', this.scene);
    parkMat.diffuseColor = new Color3(0.2, 0.45, 0.15); // Green
    parkMat.specularColor = new Color3(0.02, 0.02, 0.02);
    parkMat.freeze();
    parkGround.material = parkMat;
    parkGround.receiveShadows = true;
    parkGround.freezeWorldMatrix();
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
        Diag.count('City', 'chunksGenerated');
      }
      Diag.track('City', 'pendingChunks', this.pendingChunks.length);
    }

    // Update fade-in for chunks and unload distant ones
    const now = performance.now();
    for (const [key, chunk] of this.chunks.entries()) {
      const dx = Math.abs(chunk.chunkX - playerChunkX);
      const dz = Math.abs(chunk.chunkZ - playerChunkZ);

      // Smooth fade-in for buildings - only iterate meshes for fading chunks
      if (!chunk.fullyVisible) {
        chunk.fadeProgress = Math.min(1, chunk.fadeProgress + 0.03);

        for (const mesh of chunk.collisionMeshes) {
          if (mesh.name.startsWith('building_')) {
            mesh.visibility = chunk.fadeProgress;
          }
        }

        if (chunk.fadeProgress >= 1) {
          chunk.fullyVisible = true;
          // Freeze world matrices on fully visible buildings - they never move
          for (const mesh of chunk.collisionMeshes) {
            mesh.freezeWorldMatrix();
          }
        }
      }

      // Unload distant chunks
      if (dx > UNLOAD_DISTANCE || dz > UNLOAD_DISTANCE) {
        if (now - chunk.lastAccess > 5000) {
          this.unloadChunk(key);
          Diag.count('City', 'chunksUnloaded');
        }
      }
    }

    // Diagnostics
    Diag.track('City', 'loadedChunks', this.chunks.size);
    Diag.track('City', 'updateMs', performance.now() - updateStart);

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

    // ── NYC-STYLE STREET GRID ──
    // Avenues run N-S (along Z), streets run E-W (along X).
    // Blocks are LONG rectangles between avenues, divided by cross streets.
    // Downtown has skyscrapers, midtown is mixed, outer areas are shorter.

    const distFromCenter = Math.sqrt(
      (worldX + CHUNK_SIZE / 2) ** 2 + (worldZ + CHUNK_SIZE / 2) ** 2
    );
    // More generous district zones - downtown feels big
    const isDowntown = distFromCenter < 800;
    const isMidtown = distFromCenter < 1800;

    // Height distribution - everything is taller than you'd think.
    // Superman is ~4 units tall. A 20-story building = 80 units = 20x Superman.
    // Even "short" buildings should tower over Superman.
    const heightForDistrict = (): number => {
      if (isDowntown) {
        // Manhattan Financial District / Midtown: 30-80+ stories
        return random.next() < 0.35
          ? random.range(200, 350)   // Skyscrapers (50-85 stories)
          : random.range(60, 160);   // Medium towers (15-40 stories)
      } else if (isMidtown) {
        return random.next() < 0.2
          ? random.range(120, 220)   // Occasional tall building
          : random.range(40, 100);   // 10-25 story buildings
      } else {
        // Even outer areas have 5-15 story buildings, not houses
        return random.range(25, 70);
      }
    };

    let buildingCount = 0;

    // Lay out avenues (N-S, spaced by BLOCK_WIDTH + AVENUE_WIDTH)
    let avenueX = worldX + AVENUE_WIDTH * 0.5;

    while (avenueX < worldX + CHUNK_SIZE - AVENUE_WIDTH - MIN_BUILDING_WIDTH) {
      const blockW = BLOCK_WIDTH + random.range(-10, 10); // Slight variation
      const blockEndX = Math.min(avenueX + blockW, worldX + CHUNK_SIZE - AVENUE_WIDTH);
      const actualBlockW = blockEndX - avenueX;

      if (actualBlockW < MIN_BUILDING_WIDTH) {
        avenueX = blockEndX + AVENUE_WIDTH;
        continue;
      }

      // Within this avenue-to-avenue strip, lay out cross streets
      let streetZ = worldZ + STREET_WIDTH * 0.5;

      while (streetZ < worldZ + CHUNK_SIZE - STREET_WIDTH - MIN_BUILDING_WIDTH) {
        const blockD = random.range(BLOCK_DEPTH_MIN, BLOCK_DEPTH_MAX);
        const blockEndZ = Math.min(streetZ + blockD, worldZ + CHUNK_SIZE - STREET_WIDTH);
        const actualBlockD = blockEndZ - streetZ;

        if (actualBlockD < MIN_BUILDING_WIDTH) {
          streetZ = blockEndZ + STREET_WIDTH;
          continue;
        }

        // Fill this rectangular block with buildings along the long axis (Z)
        let bz = streetZ;
        while (bz < blockEndZ - MIN_BUILDING_WIDTH && buildingCount < 25) {
          // Each building takes a slice of the block depth
          const bDepth = random.range(MIN_BUILDING_WIDTH, Math.min(MAX_BUILDING_WIDTH, blockEndZ - bz));
          const bWidth = actualBlockW; // Building fills full block width
          const bHeight = heightForDistrict();

          buildingCount = this.placeBuildingOnLot(
            key, buildingCount, avenueX, bz, bWidth, bDepth,
            bHeight, random, chunkX, chunkZ, collisionMeshes, isDowntown
          );

          bz += bDepth + BUILDING_GAP;
        }

        streetZ = blockEndZ + STREET_WIDTH;
      }

      avenueX = blockEndX + AVENUE_WIDTH;
    }

    this.chunks.set(key, {
      key,
      chunkX,
      chunkZ,
      mergedMesh: null,
      collisionMeshes,
      lastAccess: performance.now(),
      fadeProgress: 0,
      fullyVisible: false,
    });
  }

  /**
   * Places a building on a lot, filling the lot edge-to-edge.
   * Returns updated buildingCount.
   */
  private placeBuildingOnLot(
    chunkKey: string, buildingCount: number,
    lotX: number, lotZ: number, lotW: number, lotD: number, height: number,
    random: SeededRandom, chunkX: number, chunkZ: number,
    collisionMeshes: Mesh[], isDowntown: boolean
  ): number {
    const meshes = this.createBuilding(
      chunkKey, buildingCount, lotX, lotZ, lotW, lotD, height,
      random, chunkX, chunkZ, isDowntown
    );

    for (const mesh of meshes) {
      // Taller buildings cast shadows (up to 5 per chunk for performance)
      if (buildingCount < 5 && height > 60) {
        this.shadowGenerator.addShadowCaster(mesh);
      }
      mesh.visibility = 0;
      createCollisionBox(mesh, this.physicsManager);
      collisionMeshes.push(mesh);
    }

    return buildingCount + 1;
  }

  /**
   * Creates a building that fills its lot. ONE mesh per building for performance.
   * Visual variety comes from proportions, materials, and the voxel system on damage.
   */
  private createBuilding(
    chunkKey: string, index: number,
    lotX: number, lotZ: number, width: number, depth: number, height: number,
    random: SeededRandom, chunkX: number, chunkZ: number, isDowntown: boolean
  ): Mesh[] {
    const baseName = `building_${chunkKey}_${index}`;
    const matIndex = Math.abs(chunkX * 7 + chunkZ * 13 + index * 3) % this.buildingMaterials.length;
    const cx = lotX + width / 2;
    const cz = lotZ + depth / 2;

    // Pick material - ALL buildings get varied colors.
    // Tall buildings use the full material palette including glass, steel, white.
    // Short buildings tend toward concrete, brick, warm tones.
    const mat = this.buildingMaterials[matIndex];

    // ONE mesh per building - fills the lot
    const main = MeshBuilder.CreateBox(`${baseName}_main`, {
      width, height, depth
    }, this.scene);
    main.position = new Vector3(cx, height / 2 + SIDEWALK_HEIGHT, cz);
    main.material = mat;
    main.receiveShadows = true;

    return [main];
  }

  /**
   * Unloads a chunk
   */
  // Callback for external systems to clean up when chunks unload
  public onChunkUnload: ((chunkKey: string) => void) | null = null;

  private unloadChunk(key: string): void {
    const chunk = this.chunks.get(key);
    if (!chunk) return;

    // Notify external systems (e.g., BuildingDamage) to clean up
    if (this.onChunkUnload) {
      this.onChunkUnload(key);
    }

    // Dispose all meshes (buildings + sidewalk)
    for (const mesh of chunk.collisionMeshes) {
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
    return new Vector3(STREET_WIDTH / 2, 1.0, CHUNK_SIZE / 2);
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
