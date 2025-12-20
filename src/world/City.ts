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
const SIDEWALK_WIDTH = 3; // meters
const SIDEWALK_HEIGHT = 0.2; // meters

// Building size ranges
const MIN_BUILDING_HEIGHT = 15;
const MAX_BUILDING_HEIGHT = 80;
const MIN_BUILDING_WIDTH = 10;
const MAX_BUILDING_WIDTH = 25;
const BUILDING_SPACING = 5;

// Colors
const ROAD_COLOR = new Color3(0.15, 0.15, 0.15);
const SIDEWALK_COLOR = new Color3(0.5, 0.5, 0.5);
const BUILDING_COLORS = [
  new Color3(0.6, 0.6, 0.65),   // Gray
  new Color3(0.55, 0.5, 0.45),  // Tan
  new Color3(0.4, 0.45, 0.5),   // Blue-gray
  new Color3(0.5, 0.4, 0.35),   // Brown
  new Color3(0.65, 0.6, 0.55),  // Light gray
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
  private roads: Mesh[] = [];
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

    // Create road material
    const roadMaterial = new StandardMaterial('roadMaterial', this.scene);
    roadMaterial.diffuseColor = ROAD_COLOR;
    roadMaterial.specularColor = new Color3(0.1, 0.1, 0.1);

    // Create sidewalk material
    const sidewalkMaterial = new StandardMaterial('sidewalkMaterial', this.scene);
    sidewalkMaterial.diffuseColor = SIDEWALK_COLOR;
    sidewalkMaterial.specularColor = new Color3(0.2, 0.2, 0.2);

    // Generate grid of blocks
    for (let bx = 0; bx < CITY_BLOCKS_X; bx++) {
      for (let bz = 0; bz < CITY_BLOCKS_Z; bz++) {
        const blockX = offsetX + bx * (BLOCK_SIZE + STREET_WIDTH) + BLOCK_SIZE / 2;
        const blockZ = offsetZ + bz * (BLOCK_SIZE + STREET_WIDTH) + BLOCK_SIZE / 2;

        // Generate buildings in this block
        this.generateBlock(blockX, blockZ);
      }
    }

    // Generate streets
    this.generateStreets(offsetX, offsetZ, totalWidth, totalDepth, roadMaterial, sidewalkMaterial);

    // Generate perimeter ground
    this.generatePerimeterGround(totalWidth, totalDepth);
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

    building.position = new Vector3(x, height / 2, z);

    // Random building color
    const material = new StandardMaterial(`buildingMat_${this.buildings.length}`, this.scene);
    material.diffuseColor = this.random.pick(BUILDING_COLORS);
    material.specularColor = new Color3(0.1, 0.1, 0.1);
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

    // Add window details (simple strip pattern)
    this.addWindowStrips(building, width, height, depth);
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
    // Add a smaller structure on top (like AC units or elevator shaft)
    const rooftopWidth = width * 0.3;
    const rooftopDepth = depth * 0.3;
    const rooftopHeight = this.random.range(3, 6);

    const rooftop = MeshBuilder.CreateBox(
      `rooftop_${this.buildings.length}`,
      { width: rooftopWidth, height: rooftopHeight, depth: rooftopDepth },
      this.scene
    );

    rooftop.position = new Vector3(x, height + rooftopHeight / 2, z);

    const material = new StandardMaterial(`rooftopMat_${this.buildings.length}`, this.scene);
    material.diffuseColor = new Color3(0.4, 0.4, 0.4);
    rooftop.material = material;

    this.shadowGenerator.addShadowCaster(rooftop);
    createCollisionBox(rooftop, this.physicsManager);
  }

  /**
   * Adds window strip details to building
   */
  private addWindowStrips(
    building: Mesh,
    width: number,
    height: number,
    depth: number
  ): void {
    // Create dark strips for windows (simplified)
    const stripHeight = 1;
    const floorHeight = 4;
    const numFloors = Math.floor(height / floorHeight);

    // Only add a few strips to reduce geometry
    const stripInterval = Math.max(1, Math.floor(numFloors / 5));

    for (let i = 1; i < numFloors; i += stripInterval) {
      const stripY = i * floorHeight;

      // Front strip
      const strip = MeshBuilder.CreateBox(
        `windowStrip_${this.buildings.length}_${i}`,
        { width: width * 0.9, height: stripHeight, depth: 0.1 },
        this.scene
      );

      strip.position = new Vector3(
        building.position.x,
        stripY,
        building.position.z + depth / 2 + 0.05
      );

      const windowMat = new StandardMaterial(`windowMat_${i}`, this.scene);
      windowMat.diffuseColor = new Color3(0.2, 0.25, 0.3);
      windowMat.specularColor = new Color3(0.3, 0.3, 0.4);
      strip.material = windowMat;

      strip.parent = building;
    }
  }

  /**
   * Generates the street grid
   */
  private generateStreets(
    offsetX: number,
    offsetZ: number,
    totalWidth: number,
    totalDepth: number,
    roadMaterial: StandardMaterial,
    sidewalkMaterial: StandardMaterial
  ): void {
    // Create main road plane covering entire city
    const mainRoad = MeshBuilder.CreateGround(
      'mainRoad',
      { width: totalWidth + STREET_WIDTH * 2, height: totalDepth + STREET_WIDTH * 2 },
      this.scene
    );
    mainRoad.position = new Vector3(0, 0.01, 0); // Slightly above ground
    mainRoad.material = roadMaterial;
    mainRoad.receiveShadows = true;
    this.roads.push(mainRoad);

    // Create sidewalks around each block
    for (let bx = 0; bx < CITY_BLOCKS_X; bx++) {
      for (let bz = 0; bz < CITY_BLOCKS_Z; bz++) {
        const blockX = offsetX + bx * (BLOCK_SIZE + STREET_WIDTH) + BLOCK_SIZE / 2;
        const blockZ = offsetZ + bz * (BLOCK_SIZE + STREET_WIDTH) + BLOCK_SIZE / 2;

        this.createSidewalk(blockX, blockZ, BLOCK_SIZE, sidewalkMaterial);
      }
    }

    // Add road markings
    this.addRoadMarkings(offsetX, offsetZ, totalWidth, totalDepth);
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
   * Adds road lane markings
   */
  private addRoadMarkings(
    offsetX: number,
    offsetZ: number,
    totalWidth: number,
    totalDepth: number
  ): void {
    const markingMaterial = new StandardMaterial('markingMaterial', this.scene);
    markingMaterial.diffuseColor = new Color3(1, 1, 0.8);
    markingMaterial.emissiveColor = new Color3(0.2, 0.2, 0.1);

    // Horizontal streets
    for (let i = 0; i <= CITY_BLOCKS_Z; i++) {
      const z = offsetZ + i * (BLOCK_SIZE + STREET_WIDTH) - STREET_WIDTH / 2;

      // Create dashed center line
      const dashLength = 3;
      const gapLength = 3;
      let x = offsetX - STREET_WIDTH;

      while (x < offsetX + totalWidth + STREET_WIDTH) {
        const dash = MeshBuilder.CreateBox(
          `marking_h_${i}_${x}`,
          { width: dashLength, height: 0.02, depth: 0.2 },
          this.scene
        );
        dash.position = new Vector3(x + dashLength / 2, 0.02, z);
        dash.material = markingMaterial;
        x += dashLength + gapLength;
      }
    }

    // Vertical streets
    for (let i = 0; i <= CITY_BLOCKS_X; i++) {
      const x = offsetX + i * (BLOCK_SIZE + STREET_WIDTH) - STREET_WIDTH / 2;

      const dashLength = 3;
      const gapLength = 3;
      let z = offsetZ - STREET_WIDTH;

      while (z < offsetZ + totalDepth + STREET_WIDTH) {
        const dash = MeshBuilder.CreateBox(
          `marking_v_${i}_${z}`,
          { width: 0.2, height: 0.02, depth: dashLength },
          this.scene
        );
        dash.position = new Vector3(x, 0.02, z + dashLength / 2);
        dash.material = markingMaterial;
        z += dashLength + gapLength;
      }
    }
  }

  /**
   * Generates ground around the city perimeter
   */
  private generatePerimeterGround(totalWidth: number, totalDepth: number): void {
    const perimeterSize = 200;

    const perimeterMaterial = new StandardMaterial('perimeterMaterial', this.scene);
    perimeterMaterial.diffuseColor = new Color3(0.3, 0.4, 0.25); // Grass-like
    perimeterMaterial.specularColor = new Color3(0.1, 0.1, 0.1);

    // Create ground planes around city
    const positions = [
      { x: 0, z: totalDepth / 2 + perimeterSize / 2, w: totalWidth + perimeterSize * 2, d: perimeterSize }, // North
      { x: 0, z: -totalDepth / 2 - perimeterSize / 2, w: totalWidth + perimeterSize * 2, d: perimeterSize }, // South
      { x: totalWidth / 2 + perimeterSize / 2, z: 0, w: perimeterSize, d: totalDepth }, // East
      { x: -totalWidth / 2 - perimeterSize / 2, z: 0, w: perimeterSize, d: totalDepth }, // West
    ];

    positions.forEach((pos, i) => {
      const ground = MeshBuilder.CreateGround(
        `perimeterGround_${i}`,
        { width: pos.w, height: pos.d },
        this.scene
      );
      ground.position = new Vector3(pos.x, 0, pos.z);
      ground.material = perimeterMaterial;
      ground.receiveShadows = true;
      createCollisionBox(ground, this.physicsManager);
    });
  }

  /**
   * Gets all building meshes
   */
  public getBuildings(): Mesh[] {
    return this.buildings;
  }

  /**
   * Gets a random rooftop position for spawning
   */
  public getRandomRooftopPosition(): Vector3 {
    if (this.buildings.length === 0) {
      return new Vector3(0, 10, 0);
    }

    const building = this.random.pick(this.buildings);
    const bounds = building.getBoundingInfo().boundingBox;
    const height = bounds.maximum.y - bounds.minimum.y;

    return new Vector3(
      building.position.x,
      building.position.y + height / 2 + 2,
      building.position.z
    );
  }

  /**
   * Gets the spawn position (ground level near center)
   */
  public getSpawnPosition(): Vector3 {
    return new Vector3(0, 2, 0);
  }
}
