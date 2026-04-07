/**
 * Building Damage System - Handles building destruction with structural breakpoints
 * Buildings break apart at defined structural points, creating realistic destruction
 * Features realistic falling/collapse physics and dust/smoke effects
 */

import { Scene } from '@babylonjs/core/scene';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { ParticleSystem } from '@babylonjs/core/Particles/particleSystem';
import { VoxelBuilding } from './VoxelBuilding';

// Debris constants - balanced for destruction quality and performance
const MAX_DEBRIS_PIECES = 100; // Higher cap for more rubble persistence
const MAX_SMALL_DEBRIS = 40;   // Sub-cap for small debris (within MAX_DEBRIS_PIECES)
const DEBRIS_CLEANUP_DISTANCE = 200;  // Keep rubble visible longer
const DEBRIS_SETTLE_CLEANUP_TIME = 30000;  // Remove settled debris after 30 seconds
const GRAVITY = -30;  // Normal gravity for performance
const SECONDARY_FRAG_SPEED = 12;  // Min impact speed to trigger secondary fragmentation

// Import gravity zone type
import type { GravityZone } from './AlienShip';

// Dust cloud limits - particle systems are expensive!
const MAX_DUST_CLOUDS = 30;  // Hard cap on active particle systems
const DUST_CLOUD_COOLDOWN = 200;  // ms between dust spawns at same location

// Wake damage constants
const WAKE_BASE_RADIUS = 40;
const WAKE_SPEED_THRESHOLD = 80;

// Collapse constants - dramatic but not too slow
const COLLAPSE_TILT_SPEED = 0.25;  // Moderate tipping speed
const COLLAPSE_FALL_SPEED = 0.6;   // Moderate fall speed

// Debris spawn cooldown - prevents chain spawning from continuous damage (heat vision)
const DEBRIS_SPAWN_COOLDOWN = 500;  // ms between debris spawns per building

// Performance logging
const ENABLE_PERF_LOGGING = false;
const PERF_LOG_INTERVAL = 2000;  // Log every 2 seconds

// Structural integrity constants
const FLOOR_COLLAPSE_THRESHOLD = 0.45;  // Floor collapses when <45% integrity remains
const BUILDING_LEAN_THRESHOLD = 0.6;    // Building starts leaning when weakest floor <60%
const LEAN_SPEED = 0.15;                // How fast building leans (radians/sec)
const MAX_LEAN_BEFORE_COLLAPSE = 0.08;  // ~4.5 degrees before full collapse triggers
const PANCAKE_DAMAGE_MULT = 1.5;        // Damage multiplier when upper floor pancakes onto lower

/**
 * Debris type for varied destruction pieces
 */
const enum DebrisType {
  Concrete = 0,  // Medium box chunks
  Steel = 1,     // Long thin beams
  Glass = 2,     // Small fast shards
}

/**
 * Structural breakpoint - internal damage tracking point.
 * Breakpoints are invisible - they track damage internally.
 * When broken, rubble spawns and falls down the building face.
 * The building mesh itself shrinks as floors collapse.
 */
interface BreakPoint {
  relativePosition: Vector3;  // Position relative to building center (0-1 range)
  size: Vector3;              // Size of rubble to spawn when broken
  broken: boolean;
  threshold: number;
  floor: number;
  isLoadBearing: boolean;
}

/**
 * Per-floor structural data
 */
interface FloorData {
  totalPoints: number;
  brokenPoints: number;
  collapsed: boolean;
  floorY: number;         // Normalized Y position (0-1)
}

/**
 * Building structure data for destruction.
 * The original mesh stays visible and is scaled/repositioned as it crumbles.
 * No fragmentation into segments - the building IS the mesh.
 */
interface BuildingStructure {
  mesh: Mesh;
  breakPoints: BreakPoint[];
  floors: FloorData[];
  originalPosition: Vector3;
  originalHeight: number;       // Original building height
  currentHeight: number;        // Shrinks as top floors collapse
  bounds: { min: Vector3; max: Vector3 };
  shakeTime: number;
  shakeOffset: Vector3;
  leanAngle: number;
  leanDirection: Vector3;
  isLeaning: boolean;
  weakestFloor: number;
  damageLevel: number;          // 0-1 overall damage for visual effects
}

/**
 * Debris piece data
 */
interface DebrisPiece {
  mesh: Mesh;
  velocity: Vector3;
  angularVelocity: Vector3;
  isChunk: boolean;       // Large structural chunk vs small debris
  settled: boolean;       // Has come to rest on ground
  settleTime: number;     // When debris settled (for time-based cleanup)
  debrisType: DebrisType; // What kind of material
}

/**
 * Pancaking floor section - upper portion of building falling after floor collapse
 * Uses a single box mesh for the entire falling section (performant)
 */
interface PancakeSection {
  sectionMesh: Mesh;       // Single box representing upper building portion
  buildingMesh: Mesh;      // Reference to original building
  currentY: number;        // Current world Y position
  targetY: number;         // Where it will land (top of floor below, or ground)
  fallVelocity: number;    // Accelerating under gravity
  floorsAbove: number;     // How many floors this section contains
  structure: BuildingStructure | null; // Reference for cascading damage
  hasImpacted: boolean;
}

/**
 * Collapsing building - building that is falling over
 */
interface CollapsingBuilding {
  mesh: Mesh;
  originalPosition: Vector3;
  fallDirection: Vector3;  // Direction building tips towards
  tiltAngle: number;       // Current tilt in radians
  fallProgress: number;    // 0 = standing, 1 = fallen
  height: number;          // Building height for pivot calculation
  dustSpawned: boolean;    // Whether we've spawned the big dust cloud
  lastDustTime: number;    // Track continuous dust spawning
  debrisSpawned: number;   // Track debris spawned during collapse
}

/**
 * Dust cloud particle system
 */
interface DustCloud {
  particles: ParticleSystem;
  lifetime: number;
}

/**
 * Building damage system with structural breakpoints
 */
export class BuildingDamage {
  private scene: Scene;
  private debris: DebrisPiece[] = [];
  private buildingStructures: Map<Mesh, BuildingStructure> = new Map();
  private voxelBuildings: Map<Mesh, VoxelBuilding> = new Map();
  private debrisMaterials: StandardMaterial[] = [];
  private collapsingBuildings: CollapsingBuilding[] = [];
  private pancakeSections: PancakeSection[] = [];
  private dustClouds: DustCloud[] = [];

  // Debris spawn cooldown tracking - prevents chain spawning
  private lastDebrisSpawnTime: Map<string, number> = new Map();

  // Dust cloud cooldown tracking - prevents particle system spam
  private lastDustSpawnTime: Map<string, number> = new Map();

  // Gravity zone for alien ship beam effect
  private gravityZone: GravityZone | null = null;
  private getGravityAtPosition: ((position: Vector3) => number) | null = null;

  // Performance tracking
  private lastPerfLogTime: number = 0;
  private frameCount: number = 0;
  private totalUpdateTime: number = 0;

  constructor(scene: Scene) {
    this.scene = scene;
    this.createDebrisMaterials();
  }

  /**
   * Sets the gravity zone for oscillating gravity effects (from alien ship)
   */
  public setGravityZone(zone: GravityZone, gravityFunc: (position: Vector3) => number): void {
    this.gravityZone = zone;
    this.getGravityAtPosition = gravityFunc;
  }

  /**
   * Creates varied debris materials
   */
  private createDebrisMaterials(): void {
    const colors = [
      new Color3(0.5, 0.5, 0.55),
      new Color3(0.35, 0.35, 0.4),
      new Color3(0.45, 0.42, 0.4),
      new Color3(0.55, 0.52, 0.5),
    ];

    for (let i = 0; i < colors.length; i++) {
      const mat = new StandardMaterial(`debrisMat_${i}`, this.scene);
      mat.diffuseColor = colors[i];
      mat.specularColor = new Color3(0.1, 0.1, 0.1);
      mat.freeze();
      this.debrisMaterials.push(mat);
    }
  }

  /**
   * Generates structural breakpoints for a building using a 3D grid
   * Creates a dense grid with floor-level structural tracking
   * Center columns are load-bearing - breaking them weakens the whole floor
   */
  private generateBreakPoints(building: Mesh): { breakPoints: BreakPoint[], floors: FloorData[] } {
    const bounds = building.getBoundingInfo().boundingBox;
    const size = bounds.maximumWorld.subtract(bounds.minimumWorld);
    const breakPoints: BreakPoint[] = [];
    const floors: FloorData[] = [];

    // Grid dimensions - segments tile exactly to fill the building volume
    const gridCols = 4;
    const gridRows = 4;
    const numFloors = Math.max(3, Math.floor(size.y / 10));

    // Each segment is exactly 1/4 of the building width/depth (no gaps)
    const segWidth = size.x / gridCols;
    const segDepth = size.z / gridRows;
    const floorHeight = size.y / numFloors;

    for (let floor = 0; floor < numFloors; floor++) {
      // Y position: center of this floor's segment
      const floorY = (floor + 0.5) / numFloors;
      let pointsOnFloor = 0;

      for (let col = 0; col < gridCols; col++) {
        for (let row = 0; row < gridRows; row++) {
          // Relative position: center of this cell, mapped to -0.5..0.5 range
          const relX = (col + 0.5) / gridCols - 0.5;
          const relZ = (row + 0.5) / gridRows - 0.5;

          // Center 2x2 cells are load-bearing
          const isCenter = col >= 1 && col <= 2 && row >= 1 && row <= 2;
          const isEdge = col === 0 || col === gridCols - 1 || row === 0 || row === gridRows - 1;
          const isTop = floor >= numFloors - 1;
          const isBottom = floor === 0;

          let threshold: number;
          if (isCenter) {
            threshold = isBottom ? 0.8 : 0.5 + Math.random() * 0.2;
          } else if (isEdge) {
            threshold = isTop ? 0.12 : 0.2 + Math.random() * 0.15;
          } else {
            threshold = 0.3 + Math.random() * 0.2;
          }

          breakPoints.push({
            relativePosition: new Vector3(relX, floorY, relZ),
            // Segments tile exactly - full cell size with tiny margin for visual seam
            size: new Vector3(segWidth - 0.1, floorHeight - 0.1, segDepth - 0.1),
            broken: false,
            threshold,
            floor,
            isLoadBearing: isCenter,
          });
          pointsOnFloor++;
        }
      }

      floors.push({
        totalPoints: pointsOnFloor,
        brokenPoints: 0,
        collapsed: false,
        floorY,
      });
    }

    // Rooftop chunks
    breakPoints.push({
      relativePosition: new Vector3(0, 0.95, 0),
      size: new Vector3(size.x * 0.4, size.y * 0.08, size.z * 0.4),
      broken: false,
      threshold: 0.1,
      floor: numFloors - 1,
      isLoadBearing: false,

    });
    breakPoints.push({
      relativePosition: new Vector3(-0.25, 0.95, 0.25),
      size: new Vector3(size.x * 0.2, size.y * 0.06, size.z * 0.2),
      broken: false,
      threshold: 0.1,
      floor: numFloors - 1,
      isLoadBearing: false,

    });

    return { breakPoints, floors };
  }

  /**
   * Gets or creates building structure data
   */
  private getOrCreateStructure(building: Mesh): BuildingStructure {
    let structure = this.buildingStructures.get(building);

    if (!structure) {
      const bounds = building.getBoundingInfo().boundingBox;
      const { breakPoints, floors } = this.generateBreakPoints(building);
      const height = bounds.maximumWorld.y - bounds.minimumWorld.y;
      structure = {
        mesh: building,
        breakPoints,
        floors,
        originalPosition: building.position.clone(),
        originalHeight: height,
        currentHeight: height,
        bounds: {
          min: bounds.minimumWorld.clone(),
          max: bounds.maximumWorld.clone(),
        },
        shakeTime: 0,
        shakeOffset: Vector3.Zero(),
        leanAngle: 0,
        leanDirection: Vector3.Zero(),
        isLeaning: false,
        weakestFloor: -1,
        damageLevel: 0,
      };
      this.buildingStructures.set(building, structure);
    }

    return structure;
  }

  /**
   * Converts a building mesh to a voxel building on first damage.
   * The original mesh is hidden and replaced with a thin-instance voxel grid.
   */
  private getOrCreateVoxelBuilding(building: Mesh): VoxelBuilding {
    let vb = this.voxelBuildings.get(building);
    if (!vb) {
      const bounds = building.getBoundingInfo().boundingBox;
      const size = bounds.maximumWorld.subtract(bounds.minimumWorld);
      const material = (building.material as StandardMaterial) || this.debrisMaterials[0];

      vb = new VoxelBuilding(
        this.scene,
        new Vector3(building.position.x, bounds.minimumWorld.y, building.position.z),
        size.x, size.y, size.z,
        material
      );

      // Hide the original building mesh
      building.isVisible = false;

      this.voxelBuildings.set(building, vb);
    }
    return vb;
  }

  /**
   * Spawns debris for each removed voxel block position
   */
  private spawnVoxelDebris(positions: Vector3[], impactPosition: Vector3, speed: number): void {
    const maxSpawn = Math.min(positions.length, MAX_DEBRIS_PIECES - this.debris.length, 12);

    for (let i = 0; i < maxSpawn; i++) {
      const pos = positions[i];
      const dirX = pos.x - impactPosition.x;
      const dirZ = pos.z - impactPosition.z;
      const dirLen = Math.sqrt(dirX * dirX + dirZ * dirZ) || 1;

      // Varied rubble sizes
      const sizeBase = 0.8 + Math.random() * 2;
      const rubble = MeshBuilder.CreateBox(`rbl_${this.debris.length}`, {
        width: sizeBase * (0.4 + Math.random() * 0.8),
        height: sizeBase * (0.3 + Math.random() * 0.5),
        depth: sizeBase * (0.4 + Math.random() * 0.8),
      }, this.scene);
      rubble.position.copyFrom(pos);
      rubble.material = this.debrisMaterials[Math.floor(Math.random() * this.debrisMaterials.length)];
      rubble.isPickable = false;
      rubble.rotation.set(Math.random(), Math.random() * Math.PI, Math.random());

      const push = Math.min(speed * 0.1, 10);
      this.debris.push({
        mesh: rubble,
        velocity: new Vector3(
          (dirX / dirLen) * push + (Math.random() - 0.5) * 4,
          1 + Math.random() * 4,
          (dirZ / dirLen) * push + (Math.random() - 0.5) * 4
        ),
        angularVelocity: new Vector3(
          (Math.random() - 0.5) * 4,
          (Math.random() - 0.5) * 2,
          (Math.random() - 0.5) * 4
        ),
        isChunk: true,
        settled: false,
        settleTime: 0,
        debrisType: DebrisType.Concrete,
      });
    }
  }

  /**
   * Applies impact damage from DIRECT player collision.
   * This is the ONLY method that voxelizes buildings.
   * Converts the building to voxels and punches a hole through it.
   */
  public applyImpactDamage(building: Mesh, impactPosition: Vector3, speed: number): void {
    // Convert to voxel building on first direct player hit
    const vb = this.getOrCreateVoxelBuilding(building);

    // Punch-through: remove blocks in a sphere at impact point
    const punchRadius = 3 + Math.min(6, speed / 20);
    const removed = vb.removeBlocksInRadius(impactPosition, punchRadius);

    if (removed.length > 0) {
      this.spawnVoxelDebris(removed, impactPosition, speed);
      this.spawnDustCloud(impactPosition, 5, 1);
      this.processUnsupportedBlocks(vb, building, impactPosition);
    }

    const structure = this.getOrCreateStructure(building);
    structure.shakeTime = Math.min(2, speed / 20);
  }

  /**
   * Applies beam/area damage WITHOUT voxelizing the building.
   * Used by alien ship beam and other continuous damage sources.
   * Uses the legacy breakpoint/shrink system to avoid converting every
   * building in range to expensive voxel grids.
   *
   * If the building was already voxelized (from a direct player hit),
   * uses the voxel system instead.
   */
  public applyBeamDamage(building: Mesh, damagePosition: Vector3, speed: number): void {
    // If already voxelized, use voxel removal
    const existingVb = this.voxelBuildings.get(building);
    if (existingVb) {
      const radius = 2 + Math.min(4, speed / 30);
      const removed = existingVb.removeBlocksInRadius(damagePosition, radius);
      if (removed.length > 0) {
        this.spawnVoxelDebris(removed, damagePosition, speed * 0.5);
        this.processUnsupportedBlocks(existingVb, building, damagePosition);
      }
      return;
    }

    // Not voxelized - use legacy breakpoint system (cheap, no grid creation)
    const structure = this.getOrCreateStructure(building);
    structure.shakeTime = Math.min(1, speed / 30);

    // Break breakpoints near damage position
    const bounds = structure.bounds;
    const buildingSize = new Vector3(
      bounds.max.x - bounds.min.x,
      structure.currentHeight,
      bounds.max.z - bounds.min.z
    );
    const relX = (damagePosition.x - structure.originalPosition.x) / buildingSize.x;
    const relY = (damagePosition.y - bounds.min.y) / structure.currentHeight;
    const relZ = (damagePosition.z - structure.originalPosition.z) / buildingSize.z;

    let broken = 0;
    for (const bp of structure.breakPoints) {
      if (bp.broken || broken >= 3) continue;
      const dx = bp.relativePosition.x - relX;
      const dy = bp.relativePosition.y - relY;
      const dz = bp.relativePosition.z - relZ;
      if (dx * dx + dy * dy + dz * dz < 0.15) {
        this.breakChunkWithType(structure, bp, damagePosition, speed);
        broken++;
      }
    }

    if (broken > 0) {
      this.checkStructuralIntegrity(structure, damagePosition);
    }
  }

  /**
   * Finds unsupported blocks in a voxel building, removes them, and spawns debris.
   * Unsupported blocks cascade - removing them can cause more blocks above to fall.
   * Limited to a few iterations per call to avoid frame drops.
   */
  private processUnsupportedBlocks(vb: VoxelBuilding, buildingMesh: Mesh, impactPos: Vector3): void {
    const maxIterations = 1; // One cascade level per call, spread across frames

    for (let iter = 0; iter < maxIterations; iter++) {
      const unsupported = vb.findUnsupportedBlocks();
      if (unsupported.length === 0) break;

      // Remove unsupported blocks and spawn them as falling debris
      const removedPositions: Vector3[] = [];
      for (const { x, y, z } of unsupported) {
        const pos = vb.removeBlock(x, y, z);
        if (pos) removedPositions.push(pos);
      }

      vb.flushChanges();

      if (removedPositions.length > 0) {
        // Falling rubble - mostly downward velocity
        const maxFalling = Math.min(removedPositions.length, MAX_DEBRIS_PIECES - this.debris.length, 8);
        for (let i = 0; i < maxFalling; i++) {
          const pos = removedPositions[i];
          const sizeBase = 0.8 + Math.random() * 2;
          const rubble = MeshBuilder.CreateBox(`fall_${this.debris.length}`, {
            width: sizeBase * (0.5 + Math.random() * 0.7),
            height: sizeBase * (0.3 + Math.random() * 0.5),
            depth: sizeBase * (0.5 + Math.random() * 0.7),
          }, this.scene);
          rubble.position.copyFrom(pos);
          rubble.material = this.debrisMaterials[Math.floor(Math.random() * this.debrisMaterials.length)];
          rubble.isPickable = false;
          rubble.rotation.set(Math.random(), Math.random() * Math.PI, Math.random());

          this.debris.push({
            mesh: rubble,
            velocity: new Vector3(
              (Math.random() - 0.5) * 3,
              -2 - Math.random() * 3, // Falls down
              (Math.random() - 0.5) * 3
            ),
            angularVelocity: new Vector3(
              (Math.random() - 0.5) * 3,
              (Math.random() - 0.5) * 2,
              (Math.random() - 0.5) * 3
            ),
            isChunk: true,
            settled: false,
            settleTime: 0,
            debrisType: DebrisType.Concrete,
          });
        }

        // Dust cloud at the collapse point
        if (removedPositions.length > 3) {
          const midPos = removedPositions[Math.floor(removedPositions.length / 2)];
          this.spawnDustCloud(midPos, 4, 1);
        }
      }
    }

    // If most of the building is gone, collapse what remains
    const remaining = vb.getSolidCount();
    const topLevel = vb.getTopLevel();
    if (remaining < 10 || topLevel < 0) {
      // Building is basically destroyed
      vb.dispose();
      this.voxelBuildings.delete(buildingMesh);
      buildingMesh.dispose();
    }
  }

  /**
   * Checks structural integrity per floor and triggers progressive collapse
   * when load-bearing capacity is exceeded
   */
  private checkStructuralIntegrity(structure: BuildingStructure, damageOrigin: Vector3): void {
    // Recalculate floor integrity
    for (const floor of structure.floors) {
      floor.brokenPoints = 0;
    }
    for (const bp of structure.breakPoints) {
      if (bp.broken && bp.floor < structure.floors.length) {
        structure.floors[bp.floor].brokenPoints++;
      }
    }

    let weakestIntegrity = 1;
    let weakestFloorIdx = -1;
    let collapseTriggered = false;

    for (let i = 0; i < structure.floors.length; i++) {
      const floor = structure.floors[i];
      if (floor.collapsed) continue;

      const integrity = 1 - (floor.brokenPoints / floor.totalPoints);

      // Count broken load-bearing columns on this floor
      let loadBearingBroken = 0;
      let loadBearingTotal = 0;
      for (const bp of structure.breakPoints) {
        if (bp.floor === i && bp.isLoadBearing) {
          loadBearingTotal++;
          if (bp.broken) loadBearingBroken++;
        }
      }

      // Load-bearing damage counts double for structural assessment
      const structuralIntegrity = loadBearingTotal > 0
        ? integrity * (1 - (loadBearingBroken / loadBearingTotal) * 0.5)
        : integrity;

      if (structuralIntegrity < weakestIntegrity) {
        weakestIntegrity = structuralIntegrity;
        weakestFloorIdx = i;
      }

      // Floor collapses when integrity drops below threshold
      if (structuralIntegrity < FLOOR_COLLAPSE_THRESHOLD && !floor.collapsed) {
        this.collapseFloor(structure, i, damageOrigin);
        collapseTriggered = true;
      }
    }

    structure.weakestFloor = weakestFloorIdx;

    // Building starts leaning when structurally weak
    if (weakestIntegrity < BUILDING_LEAN_THRESHOLD && !structure.isLeaning && !collapseTriggered) {
      structure.isLeaning = true;
      // Lean away from the most damaged side
      const dmgDx = structure.originalPosition.x - damageOrigin.x;
      const dmgDz = structure.originalPosition.z - damageOrigin.z;
      const len = Math.sqrt(dmgDx * dmgDx + dmgDz * dmgDz) || 1;
      structure.leanDirection.set(dmgDx / len, 0, dmgDz / len);
    }
  }

  /**
   * Collapses a single floor - creates a visual pancake section that falls
   * Upper floors drop as a single mesh onto the floor below, causing cascade
   */
  private collapseFloor(structure: BuildingStructure, floorIndex: number, damageOrigin: Vector3): void {
    const floor = structure.floors[floorIndex];
    floor.collapsed = true;

    const bounds = structure.bounds;
    const buildingSize = bounds.max.subtract(bounds.min);
    const floorWorldY = bounds.min.y + floor.floorY * buildingSize.y;

    // Break ALL remaining breakpoints on this floor
    for (const bp of structure.breakPoints) {
      if (bp.floor === floorIndex && !bp.broken) {
        this.breakChunkWithType(structure, bp, damageOrigin, 30);
      }
    }

    // Dust cloud at floor level
    this._impactPos.set(structure.originalPosition.x, floorWorldY, structure.originalPosition.z);
    this.spawnDustCloud(this._impactPos, 6, 1.5);

    // Spawn rubble cascade - debris tumbles down the building face
    const rubbleCount = Math.min(8, MAX_DEBRIS_PIECES - this.debris.length);
    const halfW = buildingSize.x * 0.5;
    const halfD = buildingSize.z * 0.5;
    for (let r = 0; r < rubbleCount; r++) {
      const rubbleSize = 1 + Math.random() * 3;
      const rubble = MeshBuilder.CreateBox(`rbl_${this.debris.length}`, {
        width: rubbleSize * (0.5 + Math.random() * 0.8),
        height: rubbleSize * (0.3 + Math.random() * 0.5),
        depth: rubbleSize * (0.5 + Math.random() * 0.8),
      }, this.scene);
      // Spawn on the building surface edges
      const side = Math.floor(Math.random() * 4);
      const px = side === 0 ? -halfW : side === 1 ? halfW : (Math.random() - 0.5) * buildingSize.x;
      const pz = side === 2 ? -halfD : side === 3 ? halfD : (Math.random() - 0.5) * buildingSize.z;
      rubble.position.set(
        structure.originalPosition.x + px,
        floorWorldY + Math.random() * 5,
        structure.originalPosition.z + pz
      );
      rubble.material = this.debrisMaterials[Math.floor(Math.random() * this.debrisMaterials.length)];
      rubble.isPickable = false;
      rubble.rotation.set(Math.random(), Math.random() * Math.PI, Math.random());

      // Rubble falls outward and down - tumbles off the building
      this.debris.push({
        mesh: rubble,
        velocity: new Vector3(
          px * 0.15 + (Math.random() - 0.5) * 3,
          -2 - Math.random() * 5,
          pz * 0.15 + (Math.random() - 0.5) * 3
        ),
        angularVelocity: new Vector3(
          (Math.random() - 0.5) * 4,
          (Math.random() - 0.5) * 2,
          (Math.random() - 0.5) * 4
        ),
        isChunk: true,
        settled: false,
        settleTime: 0,
        debrisType: DebrisType.Concrete,
      });
    }

    // Shrink the building mesh to remove the collapsed floor visually
    structure.currentHeight = structure.originalHeight * (floorIndex / structure.floors.length);
    const heightRatio = structure.currentHeight / structure.originalHeight;
    if (heightRatio > 0.05) {
      structure.mesh.scaling.y = heightRatio;
      structure.mesh.position.y = bounds.min.y + structure.currentHeight * 0.5;
    }

    // Count how many floors above this one are still intact
    let floorsAbove = 0;
    for (let i = floorIndex + 1; i < structure.floors.length; i++) {
      if (!structure.floors[i].collapsed) floorsAbove++;
    }

    // Create a visible pancake section - the upper building portion falls
    if (floorsAbove > 0) {
      const upperHeight = buildingSize.y * (floorsAbove / structure.floors.length);
      const sectionStartY = floorWorldY + buildingSize.y / structure.floors.length;

      // Find where it should land (top of next intact floor below, or ground)
      let landingY = bounds.min.y; // Ground level
      for (let i = floorIndex - 1; i >= 0; i--) {
        if (!structure.floors[i].collapsed) {
          landingY = bounds.min.y + structure.floors[i].floorY * buildingSize.y
            + buildingSize.y / structure.floors.length;
          break;
        }
      }

      // Create a single box mesh for the falling section
      const sectionMesh = MeshBuilder.CreateBox(
        `pancake_${this.pancakeSections.length}`,
        { width: buildingSize.x * 0.95, height: upperHeight, depth: buildingSize.z * 0.95 },
        this.scene
      );
      sectionMesh.position.set(
        structure.originalPosition.x,
        sectionStartY + upperHeight * 0.5,
        structure.originalPosition.z
      );
      sectionMesh.material = structure.mesh.material;
      sectionMesh.isPickable = false;

      this.pancakeSections.push({
        sectionMesh,
        buildingMesh: structure.mesh,
        currentY: sectionMesh.position.y,
        targetY: landingY + upperHeight * 0.5,
        fallVelocity: 0,
        floorsAbove,
        structure,
        hasImpacted: false,
      });

      // Shrink the original building to represent only the lower surviving portion
      const survivingFraction = floorIndex / structure.floors.length;
      if (survivingFraction > 0.05) {
        structure.mesh.scaling.y = survivingFraction;
        structure.mesh.position.y = bounds.min.y + (buildingSize.y * survivingFraction) * 0.5;
      }

      // Mark upper floors as collapsed too (they're now part of the pancake section)
      for (let i = floorIndex + 1; i < structure.floors.length; i++) {
        structure.floors[i].collapsed = true;
      }
    }

    // Check if enough floors are gone that the building should fully collapse
    let collapsedFloors = 0;
    for (const f of structure.floors) {
      if (f.collapsed) collapsedFloors++;
    }

    if (collapsedFloors >= structure.floors.length * 0.5) {
      this.triggerFullCollapse(structure, damageOrigin);
    }
  }

  /**
   * Triggers full building collapse when structural integrity is completely gone
   */
  private triggerFullCollapse(structure: BuildingStructure, damageOrigin: Vector3): void {
    // Break all remaining breakpoints
    for (const bp of structure.breakPoints) {
      if (!bp.broken) {
        this.breakChunkWithType(structure, bp, damageOrigin, 40);
      }
    }

    this.spawnImpactDebris(damageOrigin, 30, 12);

    // Calculate fall direction from lean or damage
    const fallDir = structure.isLeaning
      ? structure.leanDirection.clone()
      : structure.originalPosition.subtract(damageOrigin);
    fallDir.y = 0;
    if (fallDir.length() < 0.1) {
      fallDir.x = Math.random() - 0.5;
      fallDir.z = Math.random() - 0.5;
    }
    fallDir.normalize();

    const height = structure.bounds.max.y - structure.bounds.min.y;

    // Use existing lean angle as starting tilt
    this.collapsingBuildings.push({
      mesh: structure.mesh,
      originalPosition: structure.originalPosition.clone(),
      fallDirection: fallDir,
      tiltAngle: structure.leanAngle,
      fallProgress: 0,
      height,
      dustSpawned: false,
      lastDustTime: 0,
      debrisSpawned: 0,
    });

    this.spawnDustCloud(damageOrigin, 8, 2);
    this._impactPos.set(damageOrigin.x, damageOrigin.y + height * 0.3, damageOrigin.z);
    this.spawnDustCloud(this._impactPos, 6, 1.5);

    this.buildingStructures.delete(structure.mesh);
  }

  /**
   * Applies supersonic wake damage to nearby buildings (no direct contact needed)
   * Breaks off pieces from buildings leaving holes - NO full destruction
   */
  // Reusable vectors for wake damage calculations
  private _flyDir = new Vector3();
  private _toBuilding = new Vector3();
  private _chunkToPlayer = new Vector3();
  private _impactPos = new Vector3();

  public applySupersonicWakeDamage(
    playerPosition: Vector3,
    playerVelocity: Vector3,
    speed: number,
    buildings: Mesh[]
  ): void {
    if (speed < WAKE_SPEED_THRESHOLD) return;

    const wakeRadius = WAKE_BASE_RADIUS + (speed - WAKE_SPEED_THRESHOLD) * 0.3;
    const wakeRadiusSq = wakeRadius * wakeRadius;

    // Get normalized flight direction - reuse vector
    this._flyDir.set(playerVelocity.x, 0, playerVelocity.z);
    const flyLen = this._flyDir.length();
    if (flyLen < 0.1) return;
    this._flyDir.scaleInPlace(1 / flyLen);

    for (const building of buildings) {
      const buildingPos = building.position;
      const dx = buildingPos.x - playerPosition.x;
      const dz = buildingPos.z - playerPosition.z;
      const horizontalDistSq = dx * dx + dz * dz;

      if (horizontalDistSq < wakeRadiusSq && horizontalDistSq > 64) { // 8^2
        const horizontalDist = Math.sqrt(horizontalDistSq);
        const invDist = 1 / horizontalDist;
        this._toBuilding.set(dx * invDist, 0, dz * invDist);

        const dot = Math.abs(Vector3.Dot(this._toBuilding, this._flyDir));

        if (dot < 0.5) {
          // Use beam damage - only voxelizes already-voxelized buildings
          this._impactPos.set(
            buildingPos.x - this._toBuilding.x * (buildingPos.x - playerPosition.x) * 0.3,
            buildingPos.y + 10 + Math.random() * 20,
            buildingPos.z - this._toBuilding.z * (buildingPos.z - playerPosition.z) * 0.3
          );
          this.applyBeamDamage(building, this._impactPos, speed * 0.3);
        }
      }
    }
  }

  /**
   * Breaks a chunk off the building at a breakpoint
   * Chunks fall realistically with gravity, not explosion-style
   */
  private breakChunk(
    structure: BuildingStructure,
    breakPoint: BreakPoint,
    impactPosition: Vector3,
    speed: number
  ): void {
    // Check debris cap - chunks count towards the limit
    if (this.debris.length >= MAX_DEBRIS_PIECES) {
      breakPoint.broken = true;  // Still mark as broken to prevent retry
      return;
    }

    breakPoint.broken = true;

    const bounds = structure.bounds;
    const buildingSize = bounds.max.subtract(bounds.min);

    // Calculate world position of chunk
    const chunkPos = new Vector3(
      structure.originalPosition.x + breakPoint.relativePosition.x * buildingSize.x,
      bounds.min.y + breakPoint.relativePosition.y * buildingSize.y,
      structure.originalPosition.z + breakPoint.relativePosition.z * buildingSize.z
    );

    // Create the chunk mesh
    const chunk = MeshBuilder.CreateBox(
      `chunk_${Date.now()}_${Math.random()}`,
      {
        width: breakPoint.size.x,
        height: breakPoint.size.y,
        depth: breakPoint.size.z,
      },
      this.scene
    );

    chunk.position = chunkPos;
    chunk.material = this.debrisMaterials[Math.floor(Math.random() * this.debrisMaterials.length)];
    chunk.isPickable = false;

    // Calculate velocity - chunks fall with slight outward push, not explosion
    const dirFromImpact = chunkPos.subtract(impactPosition);
    dirFromImpact.y = 0;  // Keep horizontal only
    if (dirFromImpact.length() > 0.1) {
      dirFromImpact.normalize();
    }

    // Much less horizontal velocity - chunks mainly fall down
    const horizontalPush = Math.min(speed * 0.08, 8);  // Reduced from 0.4
    const velocity = new Vector3(
      dirFromImpact.x * horizontalPush + (Math.random() - 0.5) * 3,
      2 + Math.random() * 3,  // Small upward pop, then gravity takes over
      dirFromImpact.z * horizontalPush + (Math.random() - 0.5) * 3
    );

    // Random rotation
    chunk.rotation = new Vector3(
      Math.random() * 0.3,
      Math.random() * Math.PI * 2,
      Math.random() * 0.3
    );

    this.debris.push({
      mesh: chunk,
      velocity,
      angularVelocity: new Vector3(
        (Math.random() - 0.5) * 2,
        (Math.random() - 0.5) * 1,
        (Math.random() - 0.5) * 2
      ),
      isChunk: true,
      settled: false,
      settleTime: 0,
      debrisType: DebrisType.Concrete,
    });

    // Spawn small dust puff at break point
    this.spawnDustCloud(chunkPos, 3, 0.5);
  }

  /**
   * Breaks a chunk and spawns rubble debris that tumbles down the building.
   * The original building mesh stays visible - it shrinks as floors collapse.
   * Rubble spawns at the breakpoint's position on the building surface and falls.
   */
  private breakChunkWithType(
    structure: BuildingStructure,
    breakPoint: BreakPoint,
    impactPosition: Vector3,
    speed: number
  ): void {
    breakPoint.broken = true;

    // Update damage level
    let totalBroken = 0;
    for (const bp of structure.breakPoints) {
      if (bp.broken) totalBroken++;
    }
    structure.damageLevel = totalBroken / structure.breakPoints.length;

    if (this.debris.length >= MAX_DEBRIS_PIECES) return;

    const bounds = structure.bounds;
    const buildingSize = new Vector3(
      bounds.max.x - bounds.min.x,
      structure.currentHeight,
      bounds.max.z - bounds.min.z
    );

    // Spawn point: on the building surface, not inside it
    const chunkPosX = structure.originalPosition.x + breakPoint.relativePosition.x * buildingSize.x;
    const chunkPosY = bounds.min.y + breakPoint.relativePosition.y * structure.currentHeight;
    const chunkPosZ = structure.originalPosition.z + breakPoint.relativePosition.z * buildingSize.z;

    // Direction away from impact
    const dirX = chunkPosX - impactPosition.x;
    const dirZ = chunkPosZ - impactPosition.z;
    const dirLen = Math.sqrt(dirX * dirX + dirZ * dirZ) || 1;
    const normDirX = dirX / dirLen;
    const normDirZ = dirZ / dirLen;

    // Choose debris type
    let debrisType: DebrisType;
    if (breakPoint.isLoadBearing) {
      debrisType = DebrisType.Steel;
    } else if (Math.abs(breakPoint.relativePosition.x) > 0.35 || Math.abs(breakPoint.relativePosition.z) > 0.35) {
      debrisType = Math.random() < 0.35 ? DebrisType.Glass : DebrisType.Concrete;
    } else {
      debrisType = DebrisType.Concrete;
    }

    const horizontalPush = Math.min(speed * 0.08, 8);
    let chunk: Mesh;
    let vx: number, vy: number, vz: number;
    let avx: number, avy: number, avz: number;

    switch (debrisType) {
      case DebrisType.Steel: {
        // Steel beams/rebar - long thin pieces that tumble slowly
        const beamLen = breakPoint.size.y * (0.6 + Math.random() * 0.6);
        const beamThick = 0.3 + Math.random() * 0.3;
        chunk = MeshBuilder.CreateBox(`rbl_${this.debris.length}`, {
          width: beamThick, height: beamLen, depth: beamThick,
        }, this.scene);
        chunk.material = this.debrisMaterials[1];
        vx = normDirX * horizontalPush * 0.5 + (Math.random() - 0.5) * 2;
        vy = 1 + Math.random() * 2;
        vz = normDirZ * horizontalPush * 0.5 + (Math.random() - 0.5) * 2;
        avx = (Math.random() - 0.5) * 1.5;
        avy = (Math.random() - 0.5) * 0.5;
        avz = (Math.random() - 0.5) * 1.5;
        break;
      }
      case DebrisType.Glass: {
        // Glass - small flat shards, fast
        const s = 0.3 + Math.random() * 0.6;
        chunk = MeshBuilder.CreateBox(`rbl_${this.debris.length}`, {
          width: s, height: s * 0.08, depth: s * (0.4 + Math.random() * 0.6),
        }, this.scene);
        chunk.material = this.debrisMaterials[3];
        vx = normDirX * horizontalPush * 2 + (Math.random() - 0.5) * 8;
        vy = (Math.random() - 0.5) * 5;
        vz = normDirZ * horizontalPush * 2 + (Math.random() - 0.5) * 8;
        avx = (Math.random() - 0.5) * 10;
        avy = (Math.random() - 0.5) * 10;
        avz = (Math.random() - 0.5) * 10;
        break;
      }
      default: {
        // Concrete rubble - irregular-ish boxes, various sizes
        const sizeScale = 0.5 + Math.random() * 0.8;
        chunk = MeshBuilder.CreateBox(`rbl_${this.debris.length}`, {
          width: breakPoint.size.x * sizeScale * (0.5 + Math.random() * 0.5),
          height: breakPoint.size.y * sizeScale * (0.3 + Math.random() * 0.5),
          depth: breakPoint.size.z * sizeScale * (0.5 + Math.random() * 0.5),
        }, this.scene);
        chunk.material = this.debrisMaterials[Math.floor(Math.random() * this.debrisMaterials.length)];
        vx = normDirX * horizontalPush + (Math.random() - 0.5) * 3;
        vy = 1 + Math.random() * 3;
        vz = normDirZ * horizontalPush + (Math.random() - 0.5) * 3;
        avx = (Math.random() - 0.5) * 3;
        avy = (Math.random() - 0.5) * 2;
        avz = (Math.random() - 0.5) * 3;
        break;
      }
    }

    chunk.position.set(chunkPosX, chunkPosY, chunkPosZ);
    chunk.isPickable = false;
    chunk.rotation.set(Math.random() * 0.5, Math.random() * Math.PI * 2, Math.random() * 0.5);

    this.debris.push({
      mesh: chunk,
      velocity: new Vector3(vx, vy, vz),
      angularVelocity: new Vector3(avx, avy, avz),
      isChunk: debrisType !== DebrisType.Glass,
      settled: false,
      settleTime: 0,
      debrisType,
    });
  }

  /**
   * Spawns a dust/smoke cloud at a position
   * Rate-limited to prevent particle system spam
   */
  private spawnDustCloud(position: Vector3, size: number, duration: number): void {
    // Hard cap on dust clouds - particle systems are expensive
    if (this.dustClouds.length >= MAX_DUST_CLOUDS) {
      return;
    }

    // Position-based cooldown to prevent spam
    const posKey = `${Math.round(position.x / 10) * 10}_${Math.round(position.z / 10) * 10}`;
    const now = performance.now();
    const lastSpawn = this.lastDustSpawnTime.get(posKey) || 0;
    if (now - lastSpawn < DUST_CLOUD_COOLDOWN) {
      return;
    }
    this.lastDustSpawnTime.set(posKey, now);

    // Clean up old cooldown entries
    if (this.lastDustSpawnTime.size > 50) {
      for (const [key, time] of this.lastDustSpawnTime) {
        if (now - time > 2000) {
          this.lastDustSpawnTime.delete(key);
        }
      }
    }

    const particles = new ParticleSystem(`dust_${Date.now()}`, 50, this.scene);

    // Use simple sphere emitter
    particles.createSphereEmitter(size * 0.5);

    // Dust colors - tan/brown/gray
    particles.color1 = new Color4(0.7, 0.6, 0.5, 0.6);
    particles.color2 = new Color4(0.5, 0.45, 0.4, 0.4);
    particles.colorDead = new Color4(0.4, 0.35, 0.3, 0);

    // Particle sizes
    particles.minSize = size * 0.8;
    particles.maxSize = size * 2;

    // Slow billowing motion
    particles.minLifeTime = duration * 0.5;
    particles.maxLifeTime = duration * 1.5;

    // Slow upward drift
    particles.direction1 = new Vector3(-size * 0.3, size * 0.5, -size * 0.3);
    particles.direction2 = new Vector3(size * 0.3, size * 1.5, size * 0.3);

    particles.minEmitPower = 1;
    particles.maxEmitPower = 3;

    particles.emitter = position.clone();
    particles.emitRate = 30;

    // Grow then shrink
    particles.addSizeGradient(0, 0.5);
    particles.addSizeGradient(0.3, 1);
    particles.addSizeGradient(1, 0.3);

    particles.blendMode = ParticleSystem.BLENDMODE_STANDARD;
    particles.gravity = new Vector3(0, -2, 0);

    particles.start();

    // Stop emitting after burst
    setTimeout(() => {
      particles.emitRate = 0;
    }, 200);

    this.dustClouds.push({
      particles,
      lifetime: duration + 2,
    });
  }

  /**
   * Spawns dust cloud for building collapse - optimized for performance
   */
  private spawnCollapseDust(position: Vector3, buildingHeight: number): void {
    // Check cap - collapse dust counts as 2 regular clouds
    if (this.dustClouds.length >= MAX_DUST_CLOUDS - 1) {
      return;
    }

    const particles = new ParticleSystem(`collapse_dust_${Date.now()}`, 200, this.scene);

    // Ground-level emission
    particles.createCylinderEmitter(buildingHeight * 0.4, buildingHeight * 0.15, 0, 0);

    // Dust colors
    particles.color1 = new Color4(0.6, 0.5, 0.4, 0.8);
    particles.color2 = new Color4(0.45, 0.4, 0.35, 0.6);
    particles.colorDead = new Color4(0.35, 0.3, 0.25, 0);

    // Large billowing particles
    particles.minSize = 10;
    particles.maxSize = 25;

    particles.minLifeTime = 3;
    particles.maxLifeTime = 6;

    // Spread outward and up
    particles.direction1 = new Vector3(-18, 6, -18);
    particles.direction2 = new Vector3(18, 30, 18);

    particles.minEmitPower = 6;
    particles.maxEmitPower = 15;

    particles.emitter = position.add(new Vector3(0, 2, 0));
    particles.emitRate = 100;

    particles.addSizeGradient(0, 0.3);
    particles.addSizeGradient(0.3, 1);
    particles.addSizeGradient(1, 0.5);

    particles.blendMode = ParticleSystem.BLENDMODE_STANDARD;
    particles.gravity = new Vector3(0, -2, 0);

    particles.start();

    // Stop emitting after burst
    setTimeout(() => {
      particles.emitRate = 0;
    }, 800);

    this.dustClouds.push({
      particles,
      lifetime: 8,
    });
  }

  /**
   * Spawns smaller debris around an impact point
   * Uses cooldown to prevent chain spawning from continuous damage sources
   */
  private spawnImpactDebris(
    impactPosition: Vector3,
    speed: number,
    count: number,
    skipCooldown: boolean = false
  ): void {
    // Check cooldown based on position (rounded to grid)
    const posKey = `${Math.round(impactPosition.x / 5) * 5}_${Math.round(impactPosition.z / 5) * 5}`;
    const now = performance.now();

    if (!skipCooldown) {
      const lastSpawn = this.lastDebrisSpawnTime.get(posKey) || 0;
      if (now - lastSpawn < DEBRIS_SPAWN_COOLDOWN) {
        return;  // Skip spawning - too soon since last spawn at this location
      }
      this.lastDebrisSpawnTime.set(posKey, now);

      // Clean up old cooldown entries every so often
      if (this.lastDebrisSpawnTime.size > 100) {
        for (const [key, time] of this.lastDebrisSpawnTime) {
          if (now - time > 5000) {
            this.lastDebrisSpawnTime.delete(key);
          }
        }
      }
    }

    const actualCount = Math.min(count, MAX_DEBRIS_PIECES - this.debris.length);
    if (actualCount <= 0) return;

    for (let i = 0; i < actualCount; i++) {
      const size = 0.3 + Math.random() * 1.2;
      const debris = MeshBuilder.CreateBox(
        `debris_${Date.now()}_${i}`,
        {
          width: size * (0.4 + Math.random() * 0.6),
          height: size * (0.4 + Math.random() * 0.6),
          depth: size * (0.4 + Math.random() * 0.6),
        },
        this.scene
      );

      // Spawn near impact
      debris.position = impactPosition.add(new Vector3(
        (Math.random() - 0.5) * 4,
        (Math.random() - 0.5) * 4,
        (Math.random() - 0.5) * 4
      ));

      debris.material = this.debrisMaterials[Math.floor(Math.random() * this.debrisMaterials.length)];
      debris.isPickable = false;

      // Random outward velocity
      const velocity = new Vector3(
        (Math.random() - 0.5) * speed * 0.3,
        Math.random() * speed * 0.2 + 5,
        (Math.random() - 0.5) * speed * 0.3
      );

      debris.rotation = new Vector3(
        Math.random() * Math.PI * 2,
        Math.random() * Math.PI * 2,
        Math.random() * Math.PI * 2
      );

      this.debris.push({
        mesh: debris,
        velocity,
        angularVelocity: new Vector3(
          (Math.random() - 0.5) * 8,
          (Math.random() - 0.5) * 8,
          (Math.random() - 0.5) * 8
        ),
        isChunk: false,
        settled: false,
        settleTime: 0,
        debrisType: DebrisType.Concrete,
      });
    }
  }

  /**
   * Applies shockwave damage to buildings in radius
   */
  public applyShockwaveDamage(
    position: Vector3,
    radius: number,
    force: number,
    buildings: Mesh[]
  ): void {
    for (const building of buildings) {
      const buildingPos = building.position;
      const dx = buildingPos.x - position.x;
      const dy = buildingPos.y - position.y;
      const dz = buildingPos.z - position.z;
      const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);

      if (distance < radius) {
        const damageMultiplier = 1 - (distance / radius);
        const damage = force * damageMultiplier;

        // Use beam damage (non-voxelizing) for area shockwave effects
        this.applyBeamDamage(building, position, damage * 30);
      }
    }
  }

  /**
   * Updates debris physics, building collapse, dust clouds, and shake effects
   * Only cleans up debris when player is far away
   */
  public update(deltaTime: number, playerPosition?: Vector3): void {
    const updateStart = performance.now();

    // Update collapsing buildings
    const now = performance.now();
    for (let i = this.collapsingBuildings.length - 1; i >= 0; i--) {
      const collapse = this.collapsingBuildings[i];

      // Increase tilt angle (building tips over) - slow and dramatic
      collapse.tiltAngle += COLLAPSE_TILT_SPEED * deltaTime;

      // Apply rotation around the base (pivot at ground level)
      const tiltAxis = new Vector3(-collapse.fallDirection.z, 0, collapse.fallDirection.x);
      collapse.mesh.rotationQuaternion = null;

      // Rotate around base - tilt towards fall direction
      collapse.mesh.rotation.x = Math.sin(Math.atan2(tiltAxis.x, tiltAxis.z)) * collapse.tiltAngle;
      collapse.mesh.rotation.z = Math.cos(Math.atan2(tiltAxis.x, tiltAxis.z)) * collapse.tiltAngle;

      // Move position to simulate pivot at base
      const pivotOffset = collapse.height * 0.5 * Math.sin(collapse.tiltAngle);
      collapse.mesh.position.x = collapse.originalPosition.x + collapse.fallDirection.x * pivotOffset;
      collapse.mesh.position.z = collapse.originalPosition.z + collapse.fallDirection.z * pivotOffset;

      // Lower as it tips
      collapse.mesh.position.y = collapse.originalPosition.y - collapse.height * 0.5 * (1 - Math.cos(collapse.tiltAngle));

      // Dust during collapse - less frequent for performance
      if (now - collapse.lastDustTime > 400) {  // Every 400ms
        collapse.lastDustTime = now;

        // Single dust puff
        const dustHeight = collapse.height * (0.3 + Math.random() * 0.4);
        const dustPos = collapse.mesh.position.add(new Vector3(
          (Math.random() - 0.5) * 8,
          dustHeight,
          (Math.random() - 0.5) * 8
        ));
        this.spawnDustCloud(dustPos, 3, 1);

        // Spawn debris during collapse - more chunks for realistic crumble
        if (collapse.debrisSpawned < 15) {
          this._impactPos.set(
            collapse.mesh.position.x + (Math.random() - 0.5) * 12,
            collapse.height * Math.random(),
            collapse.mesh.position.z + (Math.random() - 0.5) * 12
          );
          this.spawnImpactDebris(this._impactPos, 20, 3, true);
          collapse.debrisSpawned += 2;
        }
      }

      // When fully fallen (roughly 90 degrees)
      if (collapse.tiltAngle > Math.PI * 0.45) {
        collapse.fallProgress += COLLAPSE_FALL_SPEED * deltaTime;

        // Spawn dust cloud when hitting ground - optimized
        if (!collapse.dustSpawned) {
          this.spawnCollapseDust(collapse.mesh.position, collapse.height);
          // One additional dust cloud
          const offset = new Vector3(
            (Math.random() - 0.5) * collapse.height * 0.3,
            0,
            (Math.random() - 0.5) * collapse.height * 0.3
          );
          this.spawnDustCloud(collapse.mesh.position.add(offset), 8, 3);
          // Final debris burst - reduced
          this.spawnImpactDebris(collapse.mesh.position, 30, 12);
          collapse.dustSpawned = true;
        }

        // Scale down and sink into ground
        if (collapse.fallProgress > 1) {
          collapse.mesh.scaling.y *= 0.3;
          collapse.mesh.position.y = 2;
          this.collapsingBuildings.splice(i, 1);
        }
      }
    }

    // Update pancake sections - upper building portions falling after floor collapse
    for (let i = this.pancakeSections.length - 1; i >= 0; i--) {
      const section = this.pancakeSections[i];

      if (!section.hasImpacted) {
        // Accelerate under gravity
        section.fallVelocity += GRAVITY * deltaTime;
        section.currentY += section.fallVelocity * deltaTime;
        section.sectionMesh.position.y = section.currentY;

        // Check if reached landing point
        if (section.currentY <= section.targetY) {
          section.currentY = section.targetY;
          section.sectionMesh.position.y = section.targetY;
          section.hasImpacted = true;

          // Impact effects - dust ring and debris
          const impactPos = section.sectionMesh.position;
          this.spawnCollapseDust(impactPos, section.floorsAbove * 5);
          this.spawnImpactDebris(impactPos, Math.abs(section.fallVelocity) * 0.5, 6, true);

          // Cascading damage - the impact breaks the floor below
          if (section.structure && section.structure.floors) {
            // Find the floor we landed on and damage it
            for (let f = section.structure.floors.length - 1; f >= 0; f--) {
              const fl = section.structure.floors[f];
              if (!fl.collapsed) {
                // Impact from above breaks breakpoints on this floor
                const cascadeDamage = Math.floor(fl.totalPoints * 0.35 * PANCAKE_DAMAGE_MULT);
                let damaged = 0;
                for (const bp of section.structure.breakPoints) {
                  if (bp.floor === f && !bp.broken && damaged < cascadeDamage) {
                    bp.broken = true;
                    fl.brokenPoints++;
                    damaged++;
                  }
                }
                // Re-check structural integrity after cascade damage
                this.checkStructuralIntegrity(section.structure, impactPos);
                break;
              }
            }
          }

          // Clean up section mesh after a delay (let dust settle)
          setTimeout(() => {
            section.sectionMesh.dispose();
          }, 3000);
        }
      }

      // Remove completed sections
      if (section.hasImpacted && section.currentY <= section.targetY) {
        this.pancakeSections.splice(i, 1);
      }
    }

    // Update dust clouds
    for (let i = this.dustClouds.length - 1; i >= 0; i--) {
      const dust = this.dustClouds[i];
      dust.lifetime -= deltaTime;

      if (dust.lifetime <= 0) {
        dust.particles.dispose();
        this.dustClouds.splice(i, 1);
      }
    }

    // Only clean up small settled debris when truly near the cap
    if (this.debris.length > MAX_DEBRIS_PIECES * 0.9) {
      for (let i = this.debris.length - 1; i >= 0 && this.debris.length > MAX_DEBRIS_PIECES * 0.75; i--) {
        const p = this.debris[i];
        if (p.settled && !p.isChunk) {
          p.mesh.dispose();
          this.debris.splice(i, 1);
        }
      }
    }

    // Update debris pieces
    for (let i = this.debris.length - 1; i >= 0; i--) {
      const piece = this.debris[i];

      // If settled, check for time-based and distance-based cleanup
      if (piece.settled) {
        if (now - piece.settleTime > DEBRIS_SETTLE_CLEANUP_TIME) {
          piece.mesh.dispose();
          this.debris.splice(i, 1);
          continue;
        }
        // Distance-based cleanup - use squared distance to avoid sqrt
        if (playerPosition) {
          const dx = piece.mesh.position.x - playerPosition.x;
          const dz = piece.mesh.position.z - playerPosition.z;
          if (dx * dx + dz * dz > DEBRIS_CLEANUP_DISTANCE * DEBRIS_CLEANUP_DISTANCE) {
            piece.mesh.dispose();
            this.debris.splice(i, 1);
          }
        }
        continue;
      }

      // Apply gravity - check for gravity zone (alien ship beam)
      let currentGravity = GRAVITY;
      let inGravityZone = false;

      if (this.gravityZone && this.getGravityAtPosition) {
        const zoneCenter = this.gravityZone.center;
        const dx = piece.mesh.position.x - zoneCenter.x;
        const dz = piece.mesh.position.z - zoneCenter.z;
        const horizontalDistSq = dx * dx + dz * dz;
        const radiusSq = this.gravityZone.radius * this.gravityZone.radius;

        if (horizontalDistSq < radiusSq && piece.mesh.position.y < 230) {
          inGravityZone = true;
          currentGravity = this.getGravityAtPosition(piece.mesh.position);

          if (piece.settled) {
            piece.settled = false;
            piece.velocity.set(
              (Math.random() - 0.5) * 5,
              Math.random() * 10 + 5,
              (Math.random() - 0.5) * 5
            );
            piece.angularVelocity.set(
              (Math.random() - 0.5) * 3,
              (Math.random() - 0.5) * 2,
              (Math.random() - 0.5) * 3
            );
          }
        }
      }

      piece.velocity.y += currentGravity * deltaTime;

      if (piece.isChunk) {
        const resistanceFactor = inGravityZone ? 0.3 : 0.5;
        piece.velocity.scaleInPlace(1 - resistanceFactor * deltaTime);
      }

      // Update position - inline to avoid scale() allocation
      piece.mesh.position.x += piece.velocity.x * deltaTime;
      piece.mesh.position.y += piece.velocity.y * deltaTime;
      piece.mesh.position.z += piece.velocity.z * deltaTime;

      // Update rotation
      const rotMul = (inGravityZone ? 1.5 : 1.0) * deltaTime;
      piece.mesh.rotation.x += piece.angularVelocity.x * rotMul;
      piece.mesh.rotation.y += piece.angularVelocity.y * rotMul;
      piece.mesh.rotation.z += piece.angularVelocity.z * rotMul;

      // Ground collision
      const groundLevel = piece.isChunk ? 1 : 0.3;
      if (piece.mesh.position.y < groundLevel) {
        const impactSpeed = Math.abs(piece.velocity.y);
        piece.mesh.position.y = groundLevel;

        if (inGravityZone) {
          piece.velocity.y = Math.abs(piece.velocity.y) * 0.5 + 8;
          piece.velocity.x += (Math.random() - 0.5) * 10;
          piece.velocity.z += (Math.random() - 0.5) * 10;
          piece.angularVelocity.set(
            (Math.random() - 0.5) * 5,
            (Math.random() - 0.5) * 3,
            (Math.random() - 0.5) * 5
          );
        } else {
          piece.velocity.y *= -0.3;
          piece.velocity.x *= 0.6;
          piece.velocity.z *= 0.6;
          piece.angularVelocity.scaleInPlace(0.4);
        }

        if (piece.isChunk) {
          if (impactSpeed > 15) {
            this.spawnDustCloud(piece.mesh.position, 3, 0.5);
          }

          // Secondary fragmentation - large chunks split into smaller pieces on hard impact
          if (impactSpeed > SECONDARY_FRAG_SPEED && this.debris.length < MAX_DEBRIS_PIECES) {
            const fragCount = Math.min(3, MAX_DEBRIS_PIECES - this.debris.length);
            const bounding = piece.mesh.getBoundingInfo().boundingBox;
            const chunkSize = bounding.maximumWorld.subtract(bounding.minimumWorld);

            for (let f = 0; f < fragCount; f++) {
              const fragW = chunkSize.x * (0.3 + Math.random() * 0.3);
              const fragH = chunkSize.y * (0.3 + Math.random() * 0.3);
              const fragD = chunkSize.z * (0.3 + Math.random() * 0.3);

              const frag = MeshBuilder.CreateBox(
                `frag_${this.debris.length}`,
                { width: fragW, height: fragH, depth: fragD },
                this.scene
              );

              frag.position.x = piece.mesh.position.x + (Math.random() - 0.5) * chunkSize.x * 0.5;
              frag.position.y = groundLevel + fragH * 0.5 + Math.random() * 2;
              frag.position.z = piece.mesh.position.z + (Math.random() - 0.5) * chunkSize.z * 0.5;
              frag.material = this.debrisMaterials[Math.floor(Math.random() * this.debrisMaterials.length)];
              frag.isPickable = false;

              this.debris.push({
                mesh: frag,
                velocity: new Vector3(
                  (Math.random() - 0.5) * impactSpeed * 0.4,
                  Math.random() * impactSpeed * 0.3 + 3,
                  (Math.random() - 0.5) * impactSpeed * 0.4
                ),
                angularVelocity: new Vector3(
                  (Math.random() - 0.5) * 4,
                  (Math.random() - 0.5) * 2,
                  (Math.random() - 0.5) * 4
                ),
                isChunk: false,
                settled: false,
                settleTime: 0,
              });
            }

            // Original chunk becomes smaller after breaking
            piece.isChunk = false;
          }
        }

        // Check if settled - use squared length to avoid sqrt
        if (!inGravityZone) {
          const vLenSq = piece.velocity.x * piece.velocity.x
            + piece.velocity.y * piece.velocity.y
            + piece.velocity.z * piece.velocity.z;
          if (vLenSq < 1) {
            piece.settled = true;
            piece.settleTime = now;
            piece.velocity.setAll(0);
            piece.angularVelocity.setAll(0);
          }
        }
      }

      // Height cap
      if (inGravityZone && piece.mesh.position.y > 180) {
        piece.mesh.position.y = 180;
        piece.velocity.y = -Math.abs(piece.velocity.y) * 0.3;
      }
    }

    // Update building visual damage - shrink buildings as they take damage
    for (const [, structure] of this.buildingStructures) {
      if (structure.damageLevel <= 0) continue;

      // Count collapsed floors from top down to determine new height
      let topIntactFloor = structure.floors.length - 1;
      while (topIntactFloor >= 0 && structure.floors[topIntactFloor].collapsed) {
        topIntactFloor--;
      }

      // Shrink building to intact height
      const targetHeight = topIntactFloor >= 0
        ? structure.originalHeight * ((topIntactFloor + 1) / structure.floors.length)
        : structure.originalHeight * 0.05; // Near-ground rubble stub

      if (structure.currentHeight > targetHeight + 0.5) {
        // Gradually shrink toward target
        structure.currentHeight -= (structure.currentHeight - targetHeight) * 0.08;
        const heightRatio = structure.currentHeight / structure.originalHeight;
        structure.mesh.scaling.y = heightRatio;
        // Reposition so bottom stays grounded
        structure.mesh.position.y = structure.bounds.min.y + structure.currentHeight * 0.5;
      }
    }

    // Update building shake effects and structural lean
    for (const [building, structure] of this.buildingStructures) {
      // Progressive lean - building visibly tilts before collapsing
      if (structure.isLeaning) {
        structure.leanAngle += LEAN_SPEED * deltaTime;

        // Apply lean rotation
        building.rotationQuaternion = null;
        building.rotation.x = Math.sin(Math.atan2(structure.leanDirection.x, structure.leanDirection.z)) * structure.leanAngle;
        building.rotation.z = Math.cos(Math.atan2(structure.leanDirection.x, structure.leanDirection.z)) * structure.leanAngle;

        // Add creaking shake while leaning
        structure.shakeTime = Math.max(structure.shakeTime, 0.1);

        // Trigger full collapse when lean exceeds threshold
        if (structure.leanAngle > MAX_LEAN_BEFORE_COLLAPSE) {
          this.triggerFullCollapse(structure, structure.originalPosition.add(structure.leanDirection.scale(10)));
          continue; // Structure deleted, skip further processing
        }
      }

      // Shake effect
      if (structure.shakeTime > 0) {
        structure.shakeTime -= deltaTime;

        if (structure.shakeTime <= 0 && !structure.isLeaning) {
          building.position.copyFrom(structure.originalPosition);
        } else {
          const shakeIntensity = Math.min(structure.shakeTime, 1) * 0.4;
          building.position.x = structure.originalPosition.x + (Math.random() - 0.5) * shakeIntensity;
          building.position.y = structure.originalPosition.y;
          building.position.z = structure.originalPosition.z + (Math.random() - 0.5) * shakeIntensity;
        }
      }
    }

    // Performance logging
    if (ENABLE_PERF_LOGGING) {
      const updateEnd = performance.now();
      this.totalUpdateTime += updateEnd - updateStart;
      this.frameCount++;

      if (now - this.lastPerfLogTime > PERF_LOG_INTERVAL) {
        const avgUpdateTime = this.totalUpdateTime / this.frameCount;
        console.log('[BuildingDamage Perf]', {
          avgUpdateTime: avgUpdateTime.toFixed(2) + 'ms',
          debris: this.debris.length,
          settledDebris: this.debris.filter(d => d.settled).length,
          dustClouds: this.dustClouds.length,
          collapsingBuildings: this.collapsingBuildings.length,
          trackedBuildings: this.buildingStructures.size,
          cooldownEntries: this.lastDebrisSpawnTime.size,
        });
        this.lastPerfLogTime = now;
        this.frameCount = 0;
        this.totalUpdateTime = 0;
      }
    }
  }

  /**
   * Cleans up all debris and effects
   */
  public dispose(): void {
    for (const piece of this.debris) {
      piece.mesh.dispose();
    }
    this.debris = [];

    for (const dust of this.dustClouds) {
      dust.particles.dispose();
    }
    this.dustClouds = [];

    this.collapsingBuildings = [];
    this.buildingStructures.clear();

    for (const mat of this.debrisMaterials) {
      mat.dispose();
    }
  }
}
