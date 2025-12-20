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

// Debris constants
const MAX_DEBRIS_PIECES = 150;
const DEBRIS_CLEANUP_DISTANCE = 300;  // Only cleanup debris when player is this far away
const GRAVITY = -35;

// Wake damage constants
const WAKE_BASE_RADIUS = 40;  // Much larger base radius for side damage
const WAKE_SPEED_THRESHOLD = 80;  // Lower threshold - starts earlier

// Collapse constants
const COLLAPSE_TILT_SPEED = 0.8;  // How fast buildings tip over
const COLLAPSE_FALL_SPEED = 2.0;  // How fast buildings fall after tipping

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
  isChunk: boolean;  // Large structural chunk vs small debris
  settled: boolean;  // Has come to rest on ground
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
  private debrisMaterials: StandardMaterial[] = [];
  private collapsingBuildings: CollapsingBuilding[] = [];
  private dustClouds: DustCloud[] = [];

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

    // At high speeds (50+), fully destroy the building on impact
    if (speed > 50) {
      this.destroyBuilding(structure, impactPosition, speed);
      return;
    }

    // At moderate speeds (30+), destroy most of the building
    if (speed > 30) {
      this.heavyDamageBuilding(structure, impactPosition, speed);
      return;
    }

    // Lower speeds: break chunks near impact
    const damage = speed / 10;  // More damage per speed unit
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
   * Completely destroys a building - starts collapse animation
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

    // Calculate fall direction (away from impact)
    const fallDir = structure.originalPosition.subtract(impactPosition);
    fallDir.y = 0;
    if (fallDir.length() < 0.1) {
      fallDir.x = Math.random() - 0.5;
      fallDir.z = Math.random() - 0.5;
    }
    fallDir.normalize();

    // Get building height
    const height = structure.bounds.max.y - structure.bounds.min.y;

    // Start collapse animation
    this.collapsingBuildings.push({
      mesh: structure.mesh,
      originalPosition: structure.originalPosition.clone(),
      fallDirection: fallDir,
      tiltAngle: 0,
      fallProgress: 0,
      height: height,
      dustSpawned: false,
    });

    // Initial dust cloud at impact
    this.spawnDustCloud(impactPosition, 5, 1);

    this.buildingStructures.delete(structure.mesh);
  }

  /**
   * Applies supersonic wake damage to nearby buildings (no direct contact needed)
   * Damages buildings on the SIDES of the player's flight path
   */
  public applySupersonicWakeDamage(
    playerPosition: Vector3,
    playerVelocity: Vector3,
    speed: number,
    buildings: Mesh[]
  ): void {
    if (speed < WAKE_SPEED_THRESHOLD) return;

    // Large radius that increases with speed
    const wakeRadius = WAKE_BASE_RADIUS + (speed - WAKE_SPEED_THRESHOLD) * 0.5;
    const wakeDamage = (speed - WAKE_SPEED_THRESHOLD) / 30;  // More damage

    // Get normalized flight direction
    const flyDir = playerVelocity.clone();
    flyDir.y = 0;
    if (flyDir.length() < 0.1) return;
    flyDir.normalize();

    for (const building of buildings) {
      const buildingPos = building.position;
      const dx = buildingPos.x - playerPosition.x;
      const dz = buildingPos.z - playerPosition.z;
      const horizontalDist = Math.sqrt(dx * dx + dz * dz);

      if (horizontalDist < wakeRadius && horizontalDist > 5) {
        // Check if building is to the SIDE of the player (not in front/behind)
        const toBuilding = new Vector3(dx, 0, dz).normalize();

        // Dot product - 0 means perpendicular (exactly beside player)
        // We want buildings that are mostly perpendicular to flight direction
        const dot = Math.abs(Vector3.Dot(toBuilding, flyDir));

        // Only affect buildings that are mostly to the side (dot < 0.5 means within ~60 degrees of perpendicular)
        if (dot < 0.5) {
          const structure = this.getOrCreateStructure(building);

          // More chunks break when closer and faster
          const proximityFactor = 1 - (horizontalDist / wakeRadius);
          const sideFactor = 1 - (dot / 0.5);  // Stronger effect when more perpendicular
          const chunksToBreak = Math.floor(proximityFactor * sideFactor * wakeDamage * 5) + 2;

          // At very high speeds close by, destroy the whole building
          if (speed > 150 && horizontalDist < 20 && dot < 0.3) {
            this.destroyBuilding(structure, playerPosition, speed);
            continue;
          }

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
            if (Vector3.Dot(chunkToPlayer, toBuilding) > 0.2) {
              this.breakChunk(structure, bp, playerPosition, speed * 0.7);
              broken++;
            }
          }

          if (broken > 0) {
            structure.shakeTime = Math.min(1.5, structure.shakeTime + 0.5);
            this.spawnImpactDebris(buildingPos.add(new Vector3(0, 20, 0)), speed * 0.4, broken * 3);
          }
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
    });

    // Spawn small dust puff at break point
    this.spawnDustCloud(chunkPos, 3, 0.5);
  }

  /**
   * Spawns a dust/smoke cloud at a position
   */
  private spawnDustCloud(position: Vector3, size: number, duration: number): void {
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
   * Spawns a large dust cloud for building collapse
   */
  private spawnCollapseDust(position: Vector3, buildingHeight: number): void {
    const particles = new ParticleSystem(`collapse_dust_${Date.now()}`, 200, this.scene);

    // Large ground-level emission
    particles.createCylinderEmitter(buildingHeight * 0.3, buildingHeight * 0.1, 0, 0);

    // Dust colors
    particles.color1 = new Color4(0.65, 0.55, 0.45, 0.7);
    particles.color2 = new Color4(0.5, 0.45, 0.4, 0.5);
    particles.colorDead = new Color4(0.4, 0.35, 0.3, 0);

    // Large billowing particles
    particles.minSize = 8;
    particles.maxSize = 20;

    particles.minLifeTime = 3;
    particles.maxLifeTime = 6;

    // Spread outward and up
    particles.direction1 = new Vector3(-15, 5, -15);
    particles.direction2 = new Vector3(15, 25, 15);

    particles.minEmitPower = 5;
    particles.maxEmitPower = 15;

    particles.emitter = position.add(new Vector3(0, 2, 0));
    particles.emitRate = 100;

    particles.addSizeGradient(0, 0.3);
    particles.addSizeGradient(0.2, 1);
    particles.addSizeGradient(0.7, 1.2);
    particles.addSizeGradient(1, 0.5);

    particles.blendMode = ParticleSystem.BLENDMODE_STANDARD;
    particles.gravity = new Vector3(0, -3, 0);

    particles.start();

    // Stop emitting after initial burst
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
        isChunk: false,
        settled: false,
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
   * Updates debris physics, building collapse, dust clouds, and shake effects
   * Only cleans up debris when player is far away
   */
  public update(deltaTime: number, playerPosition?: Vector3): void {
    // Update collapsing buildings
    for (let i = this.collapsingBuildings.length - 1; i >= 0; i--) {
      const collapse = this.collapsingBuildings[i];

      // Increase tilt angle (building tips over)
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

      // When fully fallen (roughly 90 degrees)
      if (collapse.tiltAngle > Math.PI * 0.45) {
        collapse.fallProgress += COLLAPSE_FALL_SPEED * deltaTime;

        // Spawn big dust cloud when hitting ground
        if (!collapse.dustSpawned) {
          this.spawnCollapseDust(collapse.mesh.position, collapse.height);
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

    // Update dust clouds
    for (let i = this.dustClouds.length - 1; i >= 0; i--) {
      const dust = this.dustClouds[i];
      dust.lifetime -= deltaTime;

      if (dust.lifetime <= 0) {
        dust.particles.dispose();
        this.dustClouds.splice(i, 1);
      }
    }

    // Update debris pieces
    for (let i = this.debris.length - 1; i >= 0; i--) {
      const piece = this.debris[i];

      // If settled, only check for distance-based cleanup
      if (piece.settled) {
        // Only remove debris if player is far away
        if (playerPosition) {
          const dx = piece.mesh.position.x - playerPosition.x;
          const dz = piece.mesh.position.z - playerPosition.z;
          const dist = Math.sqrt(dx * dx + dz * dz);
          if (dist > DEBRIS_CLEANUP_DISTANCE) {
            piece.mesh.dispose();
            this.debris.splice(i, 1);
          }
        }
        continue;
      }

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
        const impactSpeed = Math.abs(piece.velocity.y);

        piece.mesh.position.y = groundLevel;
        piece.velocity.y *= -0.3;
        piece.velocity.x *= 0.6;
        piece.velocity.z *= 0.6;
        piece.angularVelocity.scaleInPlace(0.4);

        // Spawn dust on ground impact
        if (impactSpeed > 10) {
          this.spawnDustCloud(piece.mesh.position, piece.isChunk ? 4 : 1.5, 0.8);
        }

        // Chunks spawn smaller debris on ground impact
        if (piece.isChunk && piece.velocity.length() > 5) {
          this.spawnImpactDebris(piece.mesh.position, piece.velocity.length() * 2, 2);
        }

        // Check if settled (very slow)
        if (piece.velocity.length() < 1) {
          piece.settled = true;
          piece.velocity = Vector3.Zero();
          piece.angularVelocity = Vector3.Zero();
        }
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
