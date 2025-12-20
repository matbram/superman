/**
 * Building Damage System - Handles building destruction with structural breakpoints
 * Buildings break apart at defined structural points, creating realistic destruction
 */

import { Scene } from '@babylonjs/core/scene';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';

// Debris constants
const MAX_DEBRIS_PIECES = 80;
const DEBRIS_LIFETIME = 5;
const GRAVITY = -35;
const CHUNK_LIFETIME = 6;

/**
 * Structural breakpoint - defines where a building can break
 */
interface BreakPoint {
  relativePosition: Vector3;  // Position relative to building center (0-1 range)
  size: Vector3;              // Size of the chunk that breaks off
  broken: boolean;            // Whether this breakpoint has been triggered
  threshold: number;          // Damage threshold to break this point (0-1)
}

/**
 * Building structure data for destruction
 */
interface BuildingStructure {
  mesh: Mesh;
  breakPoints: BreakPoint[];
  originalPosition: Vector3;
  bounds: { min: Vector3; max: Vector3 };
  shakeTime: number;
  shakeOffset: Vector3;
}

/**
 * Debris piece data
 */
interface DebrisPiece {
  mesh: Mesh;
  velocity: Vector3;
  angularVelocity: Vector3;
  lifetime: number;
  isChunk: boolean;  // Large structural chunk vs small debris
}

/**
 * Building damage system with structural breakpoints
 */
export class BuildingDamage {
  private scene: Scene;
  private debris: DebrisPiece[] = [];
  private buildingStructures: Map<Mesh, BuildingStructure> = new Map();
  private debrisMaterials: StandardMaterial[] = [];

  constructor(scene: Scene) {
    this.scene = scene;
    this.createDebrisMaterials();
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
   * Generates structural breakpoints for a building
   */
  private generateBreakPoints(building: Mesh): BreakPoint[] {
    const bounds = building.getBoundingInfo().boundingBox;
    const size = bounds.maximumWorld.subtract(bounds.minimumWorld);
    const breakPoints: BreakPoint[] = [];

    // Vertical sections (floors)
    const numFloors = Math.max(2, Math.floor(size.y / 15));

    // Horizontal sections (corners and sides)
    const sections = [
      { x: -0.35, z: -0.35 },  // Corner 1
      { x: 0.35, z: -0.35 },   // Corner 2
      { x: -0.35, z: 0.35 },   // Corner 3
      { x: 0.35, z: 0.35 },    // Corner 4
      { x: 0, z: -0.4 },       // Side 1
      { x: 0, z: 0.4 },        // Side 2
      { x: -0.4, z: 0 },       // Side 3
      { x: 0.4, z: 0 },        // Side 4
    ];

    // Create breakpoints for each floor level at each section
    for (let floor = 0; floor < numFloors; floor++) {
      const floorY = (floor + 0.5) / numFloors;

      for (const section of sections) {
        // Chunk size varies based on position
        const chunkWidth = size.x * (0.25 + Math.random() * 0.15);
        const chunkHeight = size.y / numFloors * (0.7 + Math.random() * 0.3);
        const chunkDepth = size.z * (0.25 + Math.random() * 0.15);

        breakPoints.push({
          relativePosition: new Vector3(section.x, floorY, section.z),
          size: new Vector3(chunkWidth, chunkHeight, chunkDepth),
          broken: false,
          threshold: 0.3 + Math.random() * 0.5,  // Random break threshold
        });
      }
    }

    // Add top section breakpoints (rooftop chunks)
    breakPoints.push({
      relativePosition: new Vector3(0, 0.9, 0),
      size: new Vector3(size.x * 0.5, size.y * 0.15, size.z * 0.5),
      broken: false,
      threshold: 0.2,
    });

    return breakPoints;
  }

  /**
   * Gets or creates building structure data
   */
  private getOrCreateStructure(building: Mesh): BuildingStructure {
    let structure = this.buildingStructures.get(building);

    if (!structure) {
      const bounds = building.getBoundingInfo().boundingBox;
      structure = {
        mesh: building,
        breakPoints: this.generateBreakPoints(building),
        originalPosition: building.position.clone(),
        bounds: {
          min: bounds.minimumWorld.clone(),
          max: bounds.maximumWorld.clone(),
        },
        shakeTime: 0,
        shakeOffset: Vector3.Zero(),
      };
      this.buildingStructures.set(building, structure);
    }

    return structure;
  }

  /**
   * Applies impact damage from player collision
   * At high speed: fully destroys building
   * At lower speed: tears chunks off
   */
  public applyImpactDamage(building: Mesh, impactPosition: Vector3, speed: number): void {
    const structure = this.getOrCreateStructure(building);

    // At supersonic speeds (100+), fully destroy the building on impact
    if (speed > 100) {
      this.destroyBuilding(structure, impactPosition, speed);
      return;
    }

    // At high speeds (60+), destroy most of the building
    if (speed > 60) {
      this.heavyDamageBuilding(structure, impactPosition, speed);
      return;
    }

    // Lower speeds: break chunks near impact
    const damage = speed / 15;
    structure.shakeTime = Math.min(1.5, structure.shakeTime + damage * 0.3);

    const bounds = structure.bounds;
    const buildingCenter = structure.originalPosition;
    const buildingSize = bounds.max.subtract(bounds.min);

    const relativeImpact = new Vector3(
      (impactPosition.x - buildingCenter.x) / buildingSize.x,
      (impactPosition.y - bounds.min.y) / buildingSize.y,
      (impactPosition.z - buildingCenter.z) / buildingSize.z
    );

    relativeImpact.x = Math.max(-0.5, Math.min(0.5, relativeImpact.x));
    relativeImpact.y = Math.max(0, Math.min(1, relativeImpact.y));
    relativeImpact.z = Math.max(-0.5, Math.min(0.5, relativeImpact.z));

    // Break multiple chunks
    const maxChunks = Math.min(6, 2 + Math.floor(damage));

    const allBreakpoints: { bp: BreakPoint; dist: number }[] = [];
    for (const breakPoint of structure.breakPoints) {
      if (breakPoint.broken) continue;
      const dx = breakPoint.relativePosition.x - relativeImpact.x;
      const dy = breakPoint.relativePosition.y - relativeImpact.y;
      const dz = breakPoint.relativePosition.z - relativeImpact.z;
      allBreakpoints.push({ bp: breakPoint, dist: Math.sqrt(dx * dx + dy * dy + dz * dz) });
    }

    allBreakpoints.sort((a, b) => a.dist - b.dist);

    let chunksCreated = 0;
    for (const { bp } of allBreakpoints) {
      if (chunksCreated >= maxChunks) break;
      this.breakChunk(structure, bp, impactPosition, speed);
      chunksCreated++;
    }

    this.spawnImpactDebris(impactPosition, speed, 5 + chunksCreated * 2);
  }

  /**
   * Heavily damages a building - breaks most chunks
   */
  private heavyDamageBuilding(structure: BuildingStructure, impactPosition: Vector3, speed: number): void {
    structure.shakeTime = 2;

    // Break 60-80% of breakpoints
    const breakCount = Math.floor(structure.breakPoints.length * (0.6 + Math.random() * 0.2));
    let broken = 0;

    for (const bp of structure.breakPoints) {
      if (bp.broken) continue;
      if (broken >= breakCount) break;
      this.breakChunk(structure, bp, impactPosition, speed);
      broken++;
    }

    this.spawnImpactDebris(impactPosition, speed, 15);
  }

  /**
   * Completely destroys a building
   */
  private destroyBuilding(structure: BuildingStructure, impactPosition: Vector3, speed: number): void {
    // Break ALL breakpoints
    for (const bp of structure.breakPoints) {
      if (!bp.broken) {
        this.breakChunk(structure, bp, impactPosition, speed);
      }
    }

    // Lots of debris
    this.spawnImpactDebris(impactPosition, speed, 20);

    // Collapse the building mesh
    structure.mesh.scaling.y *= 0.15;
    structure.mesh.position.y = structure.originalPosition.y * 0.15;

    this.buildingStructures.delete(structure.mesh);
  }

  /**
   * Applies supersonic wake damage to nearby buildings (no direct contact needed)
   */
  public applySupersonicWakeDamage(
    playerPosition: Vector3,
    playerVelocity: Vector3,
    speed: number,
    buildings: Mesh[]
  ): void {
    if (speed < 120) return;  // Only at supersonic speeds

    const wakeRadius = 15 + (speed - 120) * 0.2;  // Radius increases with speed
    const wakeDamage = (speed - 120) / 50;  // Damage scales with speed

    for (const building of buildings) {
      const buildingPos = building.position;
      const dx = buildingPos.x - playerPosition.x;
      const dz = buildingPos.z - playerPosition.z;
      const horizontalDist = Math.sqrt(dx * dx + dz * dz);

      if (horizontalDist < wakeRadius && horizontalDist > 3) {
        // Check if building is roughly beside the player (not in front/behind)
        const toBuilding = new Vector3(dx, 0, dz).normalize();
        const flyDir = playerVelocity.clone();
        flyDir.y = 0;
        flyDir.normalize();

        // Dot product - 0 means perpendicular (beside player)
        const dot = Math.abs(Vector3.Dot(toBuilding, flyDir));

        if (dot < 0.7) {  // Building is mostly to the side
          const structure = this.getOrCreateStructure(building);

          // Determine how many chunks to break based on proximity
          const proximityFactor = 1 - (horizontalDist / wakeRadius);
          const chunksToBreak = Math.floor(proximityFactor * wakeDamage * 3) + 1;

          let broken = 0;
          for (const bp of structure.breakPoints) {
            if (bp.broken) continue;
            if (broken >= chunksToBreak) break;

            // Break chunks on the side facing the player
            const chunkWorldX = structure.originalPosition.x + bp.relativePosition.x * 20;
            const chunkWorldZ = structure.originalPosition.z + bp.relativePosition.z * 20;
            const chunkToPlayer = new Vector3(
              playerPosition.x - chunkWorldX,
              0,
              playerPosition.z - chunkWorldZ
            ).normalize();

            // Only break chunks facing the player
            if (Vector3.Dot(chunkToPlayer, toBuilding) > 0.3) {
              this.breakChunk(structure, bp, playerPosition, speed * 0.5);
              broken++;
            }
          }

          if (broken > 0) {
            structure.shakeTime = Math.min(1, structure.shakeTime + 0.3);
            this.spawnImpactDebris(buildingPos.add(new Vector3(0, 20, 0)), speed * 0.3, broken * 2);
          }
        }
      }
    }
  }

  /**
   * Breaks a chunk off the building at a breakpoint
   */
  private breakChunk(
    structure: BuildingStructure,
    breakPoint: BreakPoint,
    impactPosition: Vector3,
    speed: number
  ): void {
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

    // Calculate velocity - chunk flies away from impact
    const dirFromImpact = chunkPos.subtract(impactPosition).normalize();
    const velocity = dirFromImpact.scale(speed * 0.4 + 10);
    velocity.y += 5 + Math.random() * 10;

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
        (Math.random() - 0.5) * 3,
        (Math.random() - 0.5) * 2,
        (Math.random() - 0.5) * 3
      ),
      lifetime: CHUNK_LIFETIME,
      isChunk: true,
    });
  }

  /**
   * Spawns smaller debris around an impact point
   */
  private spawnImpactDebris(
    impactPosition: Vector3,
    speed: number,
    count: number
  ): void {
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
        lifetime: DEBRIS_LIFETIME,
        isChunk: false,
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

        // Use impact damage system with shockwave center as impact point
        this.applyImpactDamage(building, position, damage * 30);
      }
    }
  }

  /**
   * Updates debris physics and building shake effects
   */
  public update(deltaTime: number): void {
    // Update debris pieces
    for (let i = this.debris.length - 1; i >= 0; i--) {
      const piece = this.debris[i];

      // Apply gravity
      piece.velocity.y += GRAVITY * deltaTime;

      // Air resistance for large chunks
      if (piece.isChunk) {
        piece.velocity.scaleInPlace(1 - 0.5 * deltaTime);
      }

      // Update position
      piece.mesh.position.addInPlace(piece.velocity.scale(deltaTime));

      // Update rotation
      piece.mesh.rotation.x += piece.angularVelocity.x * deltaTime;
      piece.mesh.rotation.y += piece.angularVelocity.y * deltaTime;
      piece.mesh.rotation.z += piece.angularVelocity.z * deltaTime;

      // Ground collision
      const groundLevel = piece.isChunk ? 1 : 0.3;
      if (piece.mesh.position.y < groundLevel) {
        piece.mesh.position.y = groundLevel;
        piece.velocity.y *= -0.3;
        piece.velocity.x *= 0.6;
        piece.velocity.z *= 0.6;
        piece.angularVelocity.scaleInPlace(0.4);

        // Chunks spawn smaller debris on ground impact
        if (piece.isChunk && piece.velocity.length() > 5) {
          this.spawnImpactDebris(piece.mesh.position, piece.velocity.length() * 2, 2);
        }
      }

      // Update lifetime
      piece.lifetime -= deltaTime;

      // Fade out near end of life
      if (piece.lifetime < 1.5) {
        piece.mesh.visibility = piece.lifetime / 1.5;
      }

      // Remove dead debris
      if (piece.lifetime <= 0) {
        piece.mesh.dispose();
        this.debris.splice(i, 1);
      }
    }

    // Update building shake effects
    for (const [building, structure] of this.buildingStructures) {
      if (structure.shakeTime > 0) {
        structure.shakeTime -= deltaTime;

        const shakeIntensity = structure.shakeTime * 0.4;
        structure.shakeOffset = new Vector3(
          (Math.random() - 0.5) * shakeIntensity,
          0,
          (Math.random() - 0.5) * shakeIntensity
        );

        building.position = structure.originalPosition.add(structure.shakeOffset);

        if (structure.shakeTime <= 0) {
          building.position = structure.originalPosition.clone();
        }
      }
    }
  }

  /**
   * Cleans up all debris
   */
  public dispose(): void {
    for (const piece of this.debris) {
      piece.mesh.dispose();
    }
    this.debris = [];
    this.buildingStructures.clear();
    for (const mat of this.debrisMaterials) {
      mat.dispose();
    }
  }
}
