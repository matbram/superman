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
  new Color3(0.4, 0.45, 0.5),   // Dark blue-gray
  new Color3(0.65, 0.6, 0.55),  // Warm gray
  new Color3(0.3, 0.35, 0.4),   // Dark slate
];

// Window colors for lit windows
const WINDOW_COLORS = [
  new Color3(1.0, 0.95, 0.7),   // Warm yellow light
  new Color3(0.7, 0.85, 1.0),   // Cool blue light
  new Color3(0.9, 0.9, 0.8),    // Neutral light
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
   * Creates a single building with windows and details
   */
  private createBuilding(
    x: number,
    z: number,
    width: number,
    height: number,
    depth: number
  ): void {
    const buildingId = this.buildings.length;
    const buildingType = this.random.intRange(0, 10);

    // Choose building style based on random
    if (buildingType < 3 && height > 50) {
      // Tiered/stepped building
      this.createTieredBuilding(x, z, width, height, depth, buildingId);
    } else if (buildingType < 5 && width > 15 && depth > 15) {
      // L-shaped building
      this.createLShapedBuilding(x, z, width, height, depth, buildingId);
    } else {
      // Standard building with windows
      this.createStandardBuilding(x, z, width, height, depth, buildingId);
    }

    // Add rooftop details for taller buildings
    if (height > 30) {
      this.addRooftopDetails(x, z, width, height, depth);
    }
  }

  /**
   * Creates a standard box building with windows
   */
  private createStandardBuilding(
    x: number,
    z: number,
    width: number,
    height: number,
    depth: number,
    buildingId: number
  ): void {
    const building = MeshBuilder.CreateBox(
      `building_${buildingId}`,
      { width, height, depth },
      this.scene
    );

    building.position = new Vector3(x, height / 2 + SIDEWALK_HEIGHT, z);

    const baseColor = this.random.pick(BUILDING_COLORS);
    const material = new StandardMaterial(`buildingMat_${buildingId}`, this.scene);
    material.diffuseColor = baseColor;
    material.specularColor = new Color3(0.15, 0.15, 0.15);
    building.material = material;

    building.receiveShadows = true;
    this.shadowGenerator.addShadowCaster(building);
    createCollisionBox(building, this.physicsManager);
    this.buildings.push(building);

    // Add windows
    this.addBuildingWindows(x, z, width, height, depth, buildingId);
  }

  /**
   * Creates a tiered/stepped building
   */
  private createTieredBuilding(
    x: number,
    z: number,
    width: number,
    height: number,
    depth: number,
    buildingId: number
  ): void {
    const numTiers = this.random.intRange(2, 4);
    const tierHeight = height / numTiers;
    const baseColor = this.random.pick(BUILDING_COLORS);

    for (let i = 0; i < numTiers; i++) {
      const tierScale = 1 - (i * 0.15);
      const tierWidth = width * tierScale;
      const tierDepth = depth * tierScale;
      const tierY = tierHeight / 2 + SIDEWALK_HEIGHT + (i * tierHeight);

      const tier = MeshBuilder.CreateBox(
        `building_${buildingId}_tier${i}`,
        { width: tierWidth, height: tierHeight, depth: tierDepth },
        this.scene
      );

      tier.position = new Vector3(x, tierY, z);

      const material = new StandardMaterial(`buildingMat_${buildingId}_tier${i}`, this.scene);
      material.diffuseColor = baseColor;
      material.specularColor = new Color3(0.15, 0.15, 0.15);
      tier.material = material;

      tier.receiveShadows = true;
      this.shadowGenerator.addShadowCaster(tier);
      createCollisionBox(tier, this.physicsManager);

      if (i === 0) {
        this.buildings.push(tier);
      }
    }

    this.addBuildingWindows(x, z, width * 0.85, height * 0.7, depth * 0.85, buildingId);
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
    buildingId: number
  ): void {
    const baseColor = this.random.pick(BUILDING_COLORS);
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
    this.buildings.push(main);

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

    this.addBuildingWindows(x, z, width, height, depth, buildingId);
  }

  /**
   * Adds window lights to a building
   */
  private addBuildingWindows(
    x: number,
    z: number,
    width: number,
    height: number,
    depth: number,
    buildingId: number
  ): void {
    const windowSize = 1.5;
    const windowSpacingH = 4;
    const windowSpacingV = 4;
    const windowInset = 0.1;

    const windowMaterial = new StandardMaterial(`windowMat_${buildingId}`, this.scene);
    const windowColor = this.random.pick(WINDOW_COLORS);
    windowMaterial.diffuseColor = windowColor.scale(0.3);
    windowMaterial.emissiveColor = windowColor.scale(0.4);
    windowMaterial.specularColor = new Color3(0.5, 0.5, 0.5);

    // Create window strips on front and back faces
    const numWindowsH = Math.floor((width - 4) / windowSpacingH);
    const numWindowsV = Math.floor((height - 4) / windowSpacingV);

    if (numWindowsH < 1 || numWindowsV < 1) return;

    // Front face windows (merged into strips for performance)
    for (let row = 0; row < numWindowsV; row++) {
      // Randomly skip some rows to add variety
      if (this.random.next() > 0.8) continue;

      const stripWidth = (numWindowsH - 1) * windowSpacingH + windowSize;
      const windowStrip = MeshBuilder.CreateBox(
        `window_${buildingId}_front_${row}`,
        { width: stripWidth, height: windowSize, depth: windowInset },
        this.scene
      );

      const windowY = SIDEWALK_HEIGHT + 3 + row * windowSpacingV;
      windowStrip.position = new Vector3(x, windowY, z + depth / 2 + windowInset / 2);
      windowStrip.material = windowMaterial;
    }

    // Back face windows
    for (let row = 0; row < numWindowsV; row++) {
      if (this.random.next() > 0.8) continue;

      const stripWidth = (numWindowsH - 1) * windowSpacingH + windowSize;
      const windowStrip = MeshBuilder.CreateBox(
        `window_${buildingId}_back_${row}`,
        { width: stripWidth, height: windowSize, depth: windowInset },
        this.scene
      );

      const windowY = SIDEWALK_HEIGHT + 3 + row * windowSpacingV;
      windowStrip.position = new Vector3(x, windowY, z - depth / 2 - windowInset / 2);
      windowStrip.material = windowMaterial;
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
