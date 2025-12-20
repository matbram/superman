/**
 * Procedural City Generator
 * Creates a small 3D city with buildings, streets, and sidewalks
 */

import { Scene } from '@babylonjs/core/scene';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { ShadowGenerator } from '@babylonjs/core/Lights/Shadows/shadowGenerator';
import { PhysicsManager, createCollisionBox } from '../physics/physics';

// City generation constants
const CITY_BLOCKS_X = 3;
const CITY_BLOCKS_Z = 3;
const BLOCK_SIZE = 60; // meters
const STREET_WIDTH = 15; // meters
const SIDEWALK_WIDTH = 3; // meters (for building offset)
const SIDEWALK_HEIGHT = 0.15; // meters

// Building size ranges
const MIN_BUILDING_HEIGHT = 20;
const MAX_BUILDING_HEIGHT = 80;
const MIN_BUILDING_WIDTH = 12;
const MAX_BUILDING_WIDTH = 25;
const BUILDING_SPACING = 8;

// Colors
const ROAD_COLOR = new Color3(0.2, 0.2, 0.2);
const SIDEWALK_COLOR = new Color3(0.55, 0.55, 0.55);
const BUILDING_COLORS = [
  new Color3(0.7, 0.7, 0.75),   // Light Gray
  new Color3(0.6, 0.55, 0.5),   // Tan
  new Color3(0.5, 0.55, 0.6),   // Blue-gray
  new Color3(0.55, 0.45, 0.4),  // Brown
  new Color3(0.75, 0.7, 0.65),  // Off-white
];

/**
 * Seeded random number generator for deterministic city generation
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
 * City generator class
 */
export class City {
  private scene: Scene;
  private physicsManager: PhysicsManager;
  private shadowGenerator: ShadowGenerator;
  private random: SeededRandom;

  private buildings: Mesh[] = [];
  private sidewalks: Mesh[] = [];

  constructor(
    scene: Scene,
    physicsManager: PhysicsManager,
    shadowGenerator: ShadowGenerator,
    seed: number = 42
  ) {
    this.scene = scene;
    this.physicsManager = physicsManager;
    this.shadowGenerator = shadowGenerator;
    this.random = new SeededRandom(seed);

    this.generate();
  }

  /**
   * Generates the entire city
   */
  private generate(): void {
    const totalWidth = CITY_BLOCKS_X * (BLOCK_SIZE + STREET_WIDTH);
    const totalDepth = CITY_BLOCKS_Z * (BLOCK_SIZE + STREET_WIDTH);
    const offsetX = -totalWidth / 2;
    const offsetZ = -totalDepth / 2;

    // Create unified ground first (prevents z-fighting)
    this.createUnifiedGround(totalWidth, totalDepth);

    // Create road material
    const roadMaterial = new StandardMaterial('roadMaterial', this.scene);
    roadMaterial.diffuseColor = ROAD_COLOR;
    roadMaterial.specularColor = new Color3(0.05, 0.05, 0.05);

    // Create sidewalk material
    const sidewalkMaterial = new StandardMaterial('sidewalkMaterial', this.scene);
    sidewalkMaterial.diffuseColor = SIDEWALK_COLOR;
    sidewalkMaterial.specularColor = new Color3(0.1, 0.1, 0.1);

    // Generate grid of blocks with sidewalks
    for (let bx = 0; bx < CITY_BLOCKS_X; bx++) {
      for (let bz = 0; bz < CITY_BLOCKS_Z; bz++) {
        const blockX = offsetX + bx * (BLOCK_SIZE + STREET_WIDTH) + BLOCK_SIZE / 2;
        const blockZ = offsetZ + bz * (BLOCK_SIZE + STREET_WIDTH) + BLOCK_SIZE / 2;

        // Create sidewalk for this block
        this.createSidewalk(blockX, blockZ, BLOCK_SIZE, sidewalkMaterial);

        // Generate buildings in this block
        this.generateBlock(blockX, blockZ);
      }
    }

    // Add road markings (no overlapping surfaces)
    this.addRoadMarkings(offsetX, offsetZ, totalWidth, totalDepth);
  }

  /**
   * Creates unified ground plane (no overlapping surfaces)
   */
  private createUnifiedGround(totalWidth: number, totalDepth: number): void {
    const groundSize = Math.max(totalWidth, totalDepth) + 500;

    const ground = MeshBuilder.CreateGround(
      'cityGround',
      { width: groundSize, height: groundSize },
      this.scene
    );
    ground.position.y = 0;

    const groundMaterial = new StandardMaterial('groundMaterial', this.scene);
    groundMaterial.diffuseColor = new Color3(0.25, 0.35, 0.2); // Grass color
    groundMaterial.specularColor = new Color3(0.05, 0.05, 0.05);

    ground.material = groundMaterial;
    ground.receiveShadows = true;
    ground.isPickable = true;
    createCollisionBox(ground, this.physicsManager);
  }

  /**
   * Generates buildings within a city block
   */
  private generateBlock(centerX: number, centerZ: number): void {
    const halfBlock = (BLOCK_SIZE - SIDEWALK_WIDTH * 2) / 2;

    // Fill block with buildings
    let currentX = centerX - halfBlock;

    while (currentX < centerX + halfBlock - MIN_BUILDING_WIDTH) {
      let currentZ = centerZ - halfBlock;

      while (currentZ < centerZ + halfBlock - MIN_BUILDING_WIDTH) {
        // Random building dimensions
        const maxWidth = Math.min(
          MAX_BUILDING_WIDTH,
          centerX + halfBlock - currentX
        );
        const maxDepth = Math.min(
          MAX_BUILDING_WIDTH,
          centerZ + halfBlock - currentZ
        );

        if (maxWidth < MIN_BUILDING_WIDTH || maxDepth < MIN_BUILDING_WIDTH) {
          currentZ += BUILDING_SPACING;
          continue;
        }

        const width = this.random.range(MIN_BUILDING_WIDTH, maxWidth);
        const depth = this.random.range(MIN_BUILDING_WIDTH, maxDepth);
        const height = this.random.range(MIN_BUILDING_HEIGHT, MAX_BUILDING_HEIGHT);

        // Create building
        this.createBuilding(
          currentX + width / 2,
          currentZ + depth / 2,
          width,
          height,
          depth
        );

        currentZ += depth + BUILDING_SPACING;
      }

      currentX += this.random.range(MIN_BUILDING_WIDTH, MAX_BUILDING_WIDTH) + BUILDING_SPACING;
    }
  }

  /**
   * Creates a single building
   */
  private createBuilding(
    x: number,
    z: number,
    width: number,
    height: number,
    depth: number
  ): void {
    // Main building body
    const building = MeshBuilder.CreateBox(
      `building_${this.buildings.length}`,
      { width, height, depth },
      this.scene
    );

    // Position building so bottom is at sidewalk level
    building.position = new Vector3(x, height / 2 + SIDEWALK_HEIGHT, z);

    // Random building color with slight variation
    const baseColor = this.random.pick(BUILDING_COLORS);
    const material = new StandardMaterial(`buildingMat_${this.buildings.length}`, this.scene);
    material.diffuseColor = baseColor;
    material.specularColor = new Color3(0.15, 0.15, 0.15);
    building.material = material;

    // Add shadows
    building.receiveShadows = true;
    this.shadowGenerator.addShadowCaster(building);

    // Add collision
    createCollisionBox(building, this.physicsManager);

    this.buildings.push(building);

    // Add rooftop details for taller buildings
    if (height > 40) {
      this.addRooftopDetails(x, z, width, height, depth);
    }
  }

  /**
   * Adds simple rooftop structures
   */
  private addRooftopDetails(
    x: number,
    z: number,
    width: number,
    height: number,
    depth: number
  ): void {
    const rooftopWidth = width * 0.3;
    const rooftopDepth = depth * 0.3;
    const rooftopHeight = this.random.range(3, 6);

    const rooftop = MeshBuilder.CreateBox(
      `rooftop_${this.buildings.length}`,
      { width: rooftopWidth, height: rooftopHeight, depth: rooftopDepth },
      this.scene
    );

    rooftop.position = new Vector3(x, height + SIDEWALK_HEIGHT + rooftopHeight / 2, z);

    const material = new StandardMaterial(`rooftopMat_${this.buildings.length}`, this.scene);
    material.diffuseColor = new Color3(0.35, 0.35, 0.35);
    rooftop.material = material;

    this.shadowGenerator.addShadowCaster(rooftop);
    createCollisionBox(rooftop, this.physicsManager);
  }

  /**
   * Creates sidewalk around a block
   */
  private createSidewalk(
    centerX: number,
    centerZ: number,
    blockSize: number,
    material: StandardMaterial
  ): void {
    const sidewalk = MeshBuilder.CreateBox(
      `sidewalk_${this.sidewalks.length}`,
      {
        width: blockSize,
        height: SIDEWALK_HEIGHT,
        depth: blockSize,
      },
      this.scene
    );

    sidewalk.position = new Vector3(centerX, SIDEWALK_HEIGHT / 2, centerZ);
    sidewalk.material = material;
    sidewalk.receiveShadows = true;

    // Add collision for walking
    createCollisionBox(sidewalk, this.physicsManager);

    this.sidewalks.push(sidewalk);
  }

  /**
   * Adds road lane markings (simplified, no z-fighting)
   */
  private addRoadMarkings(
    offsetX: number,
    offsetZ: number,
    _totalWidth: number,
    _totalDepth: number
  ): void {
    const markingMaterial = new StandardMaterial('markingMaterial', this.scene);
    markingMaterial.diffuseColor = new Color3(1, 1, 0.7);
    markingMaterial.emissiveColor = new Color3(0.3, 0.3, 0.1);

    // Simplified road markings - just at intersections
    for (let i = 0; i <= CITY_BLOCKS_X; i++) {
      for (let j = 0; j <= CITY_BLOCKS_Z; j++) {
        const x = offsetX + i * (BLOCK_SIZE + STREET_WIDTH) - STREET_WIDTH / 2;
        const z = offsetZ + j * (BLOCK_SIZE + STREET_WIDTH) - STREET_WIDTH / 2;

        // Crosswalk marking
        const crosswalk = MeshBuilder.CreateBox(
          `crosswalk_${i}_${j}`,
          { width: STREET_WIDTH - 2, height: 0.05, depth: 2 },
          this.scene
        );
        crosswalk.position = new Vector3(x, 0.025, z);
        crosswalk.material = markingMaterial;
      }
    }
  }

  /**
   * Gets all building meshes
   */
  public getBuildings(): Mesh[] {
    return this.buildings;
  }

  /**
   * Checks if a position collides with any building
   */
  public isPositionInsideBuilding(pos: Vector3, radius: number = 1): boolean {
    for (const building of this.buildings) {
      const bounds = building.getBoundingInfo().boundingBox;
      const min = bounds.minimumWorld;
      const max = bounds.maximumWorld;

      // Check if position (with radius) is inside building bounds
      if (
        pos.x + radius > min.x && pos.x - radius < max.x &&
        pos.z + radius > min.z && pos.z - radius < max.z &&
        pos.y < max.y && pos.y > min.y - 2
      ) {
        return true;
      }
    }
    return false;
  }

  /**
   * Finds a safe spawn position on a street (not inside buildings)
   */
  public getSpawnPosition(): Vector3 {
    const totalWidth = CITY_BLOCKS_X * (BLOCK_SIZE + STREET_WIDTH);
    const totalDepth = CITY_BLOCKS_Z * (BLOCK_SIZE + STREET_WIDTH);
    const offsetX = -totalWidth / 2;
    const offsetZ = -totalDepth / 2;

    // Player center height: ground (0) + half player height (0.9) + small buffer
    const spawnY = 1.0;

    // Try to spawn on a street intersection
    for (let attempt = 0; attempt < 20; attempt++) {
      // Pick a random street intersection
      const streetX = this.random.intRange(0, CITY_BLOCKS_X);
      const streetZ = this.random.intRange(0, CITY_BLOCKS_Z);

      const x = offsetX + streetX * (BLOCK_SIZE + STREET_WIDTH) - STREET_WIDTH / 2;
      const z = offsetZ + streetZ * (BLOCK_SIZE + STREET_WIDTH) - STREET_WIDTH / 2;

      const testPos = new Vector3(x, spawnY, z);

      if (!this.isPositionInsideBuilding(testPos, 2)) {
        return testPos;
      }
    }

    // Fallback: spawn outside the city
    return new Vector3(-totalWidth / 2 - 20, spawnY, -totalDepth / 2 - 20);
  }

  /**
   * Gets a safe position on a building rooftop
   */
  public getRandomRooftopPosition(): Vector3 {
    if (this.buildings.length === 0) {
      return new Vector3(0, 20, 0);
    }

    const building = this.random.pick(this.buildings);
    const bounds = building.getBoundingInfo().boundingBox;

    return new Vector3(
      building.position.x,
      bounds.maximumWorld.y + 2,
      building.position.z
    );
  }
}
