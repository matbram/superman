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
const LOAD_RADIUS = 5;
const UNLOAD_DISTANCE = 6;
const CHUNKS_PER_FRAME = 2;

const ENABLE_CITY_PERF_LOGGING = false;
const CITY_PERF_LOG_INTERVAL = 2000;

// Street grid
const STREET_WIDTH = 8;         // Narrow urban streets
const BLOCK_MIN = 30;           // Minimum city block dimension
const BLOCK_MAX = 60;           // Maximum city block dimension
const SIDEWALK_HEIGHT = 0.15;
const BUILDING_GAP = 1;         // Tiny gap between buildings in same block

// Building size ranges (wide footprints, reasonable heights)
const MIN_BUILDING_HEIGHT = 15;
const MAX_BUILDING_HEIGHT = 150;
const MIN_BUILDING_WIDTH = 12;
const MAX_BUILDING_WIDTH = 50;

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

    // Glass tower material (blue-green reflective)
    const glassMat = new StandardMaterial('glassMat', this.scene);
    glassMat.diffuseColor = new Color3(0.18, 0.25, 0.35);
    glassMat.specularColor = new Color3(0.6, 0.6, 0.7);
    glassMat.emissiveColor = new Color3(0.05, 0.08, 0.12);
    glassMat.alpha = 0.95;
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

    // ── STREET GRID + LOT-BASED BUILDING PLACEMENT ──
    // Generate a grid of streets, then fill each lot between streets with buildings.
    // Buildings fill their lots edge-to-edge like a real city.

    // Distance from world center determines district type
    const distFromCenter = Math.sqrt(
      (worldX + CHUNK_SIZE / 2) ** 2 + (worldZ + CHUNK_SIZE / 2) ** 2
    );
    const isDowntown = distFromCenter < 500;
    const isMidtown = distFromCenter < 1200;

    // Height range based on district
    const districtMinH = isDowntown ? 50 : isMidtown ? 25 : 15;
    const districtMaxH = isDowntown ? 160 : isMidtown ? 90 : 50;

    let buildingCount = 0;

    // Generate street grid positions for this chunk
    // Streets run at regular intervals, offset by chunk position
    const streetSpacingX = random.range(BLOCK_MIN + STREET_WIDTH, BLOCK_MAX + STREET_WIDTH);
    const streetSpacingZ = random.range(BLOCK_MIN + STREET_WIDTH, BLOCK_MAX + STREET_WIDTH);
    const offsetX = worldX + STREET_WIDTH * 0.5;
    const offsetZ = worldZ + STREET_WIDTH * 0.5;

    // Iterate over lots (areas between streets)
    let lotStartX = offsetX;
    while (lotStartX < worldX + CHUNK_SIZE - STREET_WIDTH - MIN_BUILDING_WIDTH) {
      const lotWidth = random.range(BLOCK_MIN, BLOCK_MAX);
      const lotEndX = Math.min(lotStartX + lotWidth, worldX + CHUNK_SIZE - STREET_WIDTH);

      let lotStartZ = offsetZ;
      while (lotStartZ < worldZ + CHUNK_SIZE - STREET_WIDTH - MIN_BUILDING_WIDTH) {
        const lotDepth = random.range(BLOCK_MIN, BLOCK_MAX);
        const lotEndZ = Math.min(lotStartZ + lotDepth, worldZ + CHUNK_SIZE - STREET_WIDTH);

        const actualLotW = lotEndX - lotStartX;
        const actualLotD = lotEndZ - lotStartZ;

        if (actualLotW >= MIN_BUILDING_WIDTH && actualLotD >= MIN_BUILDING_WIDTH) {
          // Decide how to fill this lot: 1 big building or 2-4 smaller ones
          const lotArea = actualLotW * actualLotD;
          const splitCount = lotArea > 1500 ? random.intRange(2, 4) :
                            lotArea > 800 ? random.intRange(1, 3) : 1;

          if (splitCount === 1) {
            // Single building fills the lot
            const bHeight = random.range(districtMinH, districtMaxH);
            buildingCount = this.placeBuildingOnLot(
              key, buildingCount, lotStartX, lotStartZ, actualLotW, actualLotD,
              bHeight, random, chunkX, chunkZ, collisionMeshes, isDowntown
            );
          } else {
            // Split lot into sub-lots along the longer axis
            if (actualLotW > actualLotD) {
              // Split along X
              let subX = lotStartX;
              for (let s = 0; s < splitCount && subX < lotEndX - MIN_BUILDING_WIDTH; s++) {
                const subW = (lotEndX - subX) / (splitCount - s) + random.range(-4, 4);
                const clampedW = Math.max(MIN_BUILDING_WIDTH, Math.min(subW, lotEndX - subX));
                const bHeight = random.range(districtMinH, districtMaxH);
                buildingCount = this.placeBuildingOnLot(
                  key, buildingCount, subX, lotStartZ, clampedW, actualLotD,
                  bHeight, random, chunkX, chunkZ, collisionMeshes, isDowntown
                );
                subX += clampedW + BUILDING_GAP;
              }
            } else {
              // Split along Z
              let subZ = lotStartZ;
              for (let s = 0; s < splitCount && subZ < lotEndZ - MIN_BUILDING_WIDTH; s++) {
                const subD = (lotEndZ - subZ) / (splitCount - s) + random.range(-4, 4);
                const clampedD = Math.max(MIN_BUILDING_WIDTH, Math.min(subD, lotEndZ - subZ));
                const bHeight = random.range(districtMinH, districtMaxH);
                buildingCount = this.placeBuildingOnLot(
                  key, buildingCount, lotStartX, subZ, actualLotW, clampedD,
                  bHeight, random, chunkX, chunkZ, collisionMeshes, isDowntown
                );
                subZ += clampedD + BUILDING_GAP;
              }
            }
          }
        }

        lotStartZ = lotEndZ + STREET_WIDTH;
      }
      lotStartX = lotEndX + STREET_WIDTH;
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
      if (buildingCount < 2 && mesh.name.includes('main')) {
        this.shadowGenerator.addShadowCaster(mesh);
      }
      mesh.visibility = 0;
      createCollisionBox(mesh, this.physicsManager);
      collisionMeshes.push(mesh);
    }

    return buildingCount + 1;
  }

  /**
   * Creates a building that fills its lot.
   * Style is chosen based on height, footprint, and district.
   */
  private createBuilding(
    chunkKey: string, index: number,
    lotX: number, lotZ: number, width: number, depth: number, height: number,
    random: SeededRandom, chunkX: number, chunkZ: number, isDowntown: boolean
  ): Mesh[] {
    const meshes: Mesh[] = [];
    const baseName = `building_${chunkKey}_${index}`;
    const matIndex = Math.abs(chunkX * 7 + chunkZ * 13 + index * 3) % this.buildingMaterials.length;
    const cx = lotX + width / 2;   // Center X
    const cz = lotZ + depth / 2;   // Center Z
    const mat = this.buildingMaterials[matIndex];
    const mat2 = this.buildingMaterials[(matIndex + 3) % this.buildingMaterials.length];

    // Choose style based on building characteristics
    const isTall = height > 80;
    const isMedium = height > 40;
    const isWide = width > 30 && depth > 30;
    const styleRoll = random.next();

    if (isTall && styleRoll < 0.35) {
      // ── SETBACK TOWER ── (tall buildings with Art Deco style setbacks)
      const baseH = height * 0.35;
      const midH = height * 0.35;
      const topH = height * 0.3;

      // Base fills the lot
      const base = MeshBuilder.CreateBox(`${baseName}_base`, {
        width, height: baseH, depth
      }, this.scene);
      base.position = new Vector3(cx, baseH / 2 + SIDEWALK_HEIGHT, cz);
      base.material = mat; base.receiveShadows = true;
      meshes.push(base);

      // Mid section (75% of footprint)
      const midW = width * 0.75, midD = depth * 0.75;
      const mid = MeshBuilder.CreateBox(`${baseName}_mid`, {
        width: midW, height: midH, depth: midD
      }, this.scene);
      mid.position = new Vector3(cx, baseH + midH / 2 + SIDEWALK_HEIGHT, cz);
      mid.material = mat2; mid.receiveShadows = true;
      meshes.push(mid);

      // Top tower (50% of footprint)
      const topW = width * 0.5, topD = depth * 0.5;
      const top = MeshBuilder.CreateBox(`${baseName}_main`, {
        width: topW, height: topH, depth: topD
      }, this.scene);
      top.position = new Vector3(cx, baseH + midH + topH / 2 + SIDEWALK_HEIGHT, cz);
      top.material = isDowntown ? this.buildingMaterials[8] : mat; // Glass for downtown
      top.receiveShadows = true;
      meshes.push(top);

    } else if (isTall && styleRoll < 0.7) {
      // ── GLASS TOWER ── (modern skyscraper, fills lot, glass material)
      const main = MeshBuilder.CreateBox(`${baseName}_main`, {
        width, height, depth
      }, this.scene);
      main.position = new Vector3(cx, height / 2 + SIDEWALK_HEIGHT, cz);
      main.material = isDowntown ? this.buildingMaterials[8] : mat; // Glass
      main.receiveShadows = true;
      meshes.push(main);

      // Crown/antenna
      if (height > 100 && random.next() > 0.5) {
        const crownH = height * 0.08;
        const crown = MeshBuilder.CreateBox(`${baseName}_roof`, {
          width: width * 0.3, height: crownH, depth: depth * 0.3
        }, this.scene);
        crown.position = new Vector3(cx, height + crownH / 2 + SIDEWALK_HEIGHT, cz);
        crown.material = this.rooftopMaterial;
        crown.receiveShadows = true;
        meshes.push(crown);
      }

    } else if (isMedium && isWide) {
      // ── U-SHAPE ── (courtyard building, common in cities)
      const wallThickness = Math.max(8, width * 0.3);

      // Back wall (full width)
      const back = MeshBuilder.CreateBox(`${baseName}_main`, {
        width, height, depth: wallThickness
      }, this.scene);
      back.position = new Vector3(cx, height / 2 + SIDEWALK_HEIGHT, lotZ + wallThickness / 2);
      back.material = mat; back.receiveShadows = true;
      meshes.push(back);

      // Left wing
      const wingH = height * (0.6 + random.next() * 0.3);
      const left = MeshBuilder.CreateBox(`${baseName}_wing`, {
        width: wallThickness, height: wingH, depth: depth - wallThickness
      }, this.scene);
      left.position = new Vector3(lotX + wallThickness / 2, wingH / 2 + SIDEWALK_HEIGHT, lotZ + wallThickness + (depth - wallThickness) / 2);
      left.material = mat2; left.receiveShadows = true;
      meshes.push(left);

      // Right wing
      const rightH = height * (0.6 + random.next() * 0.3);
      const right = MeshBuilder.CreateBox(`${baseName}_ext`, {
        width: wallThickness, height: rightH, depth: depth - wallThickness
      }, this.scene);
      right.position = new Vector3(lotX + width - wallThickness / 2, rightH / 2 + SIDEWALK_HEIGHT, lotZ + wallThickness + (depth - wallThickness) / 2);
      right.material = mat; right.receiveShadows = true;
      meshes.push(right);

    } else if (isMedium) {
      // ── PODIUM + TOWER ── (wide base with narrower tower on top)
      const podiumH = Math.min(25, height * 0.3);
      const towerH = height - podiumH;

      // Podium fills lot
      const podium = MeshBuilder.CreateBox(`${baseName}_base`, {
        width, height: podiumH, depth
      }, this.scene);
      podium.position = new Vector3(cx, podiumH / 2 + SIDEWALK_HEIGHT, cz);
      podium.material = mat; podium.receiveShadows = true;
      meshes.push(podium);

      // Tower offset to one side
      const towerW = width * (0.5 + random.next() * 0.3);
      const towerD = depth * (0.5 + random.next() * 0.3);
      const offsetDir = random.next() > 0.5 ? 1 : -1;
      const tower = MeshBuilder.CreateBox(`${baseName}_main`, {
        width: towerW, height: towerH, depth: towerD
      }, this.scene);
      tower.position = new Vector3(
        cx + offsetDir * (width - towerW) * 0.25,
        podiumH + towerH / 2 + SIDEWALK_HEIGHT,
        cz
      );
      tower.material = mat2; tower.receiveShadows = true;
      meshes.push(tower);

    } else {
      // ── LOW-RISE ── (simple box fills the lot, with window bands)
      const main = MeshBuilder.CreateBox(`${baseName}_main`, {
        width, height, depth
      }, this.scene);
      main.position = new Vector3(cx, height / 2 + SIDEWALK_HEIGHT, cz);
      main.material = mat; main.receiveShadows = true;
      meshes.push(main);

      // Window band on taller low-rises
      if (height > 20) {
        const bandH = 1.5;
        const numBands = Math.min(3, Math.floor(height / 12));
        for (let b = 1; b <= numBands; b++) {
          const band = MeshBuilder.CreateBox(`${baseName}_strip${b}`, {
            width: width + 0.3, height: bandH, depth: depth + 0.3
          }, this.scene);
          band.position = new Vector3(cx, height * b / (numBands + 1) + SIDEWALK_HEIGHT, cz);
          band.material = this.windowMaterial;
          band.receiveShadows = true;
          meshes.push(band);
        }
      }
    }

    return meshes;
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
