/**
 * Physics System
 * Provides physics abstraction layer designed for future Havok WASM integration
 * Currently implements simple custom physics for character controller
 */

import { Scene } from '@babylonjs/core/scene';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Ray } from '@babylonjs/core/Culling/ray';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh';
import '@babylonjs/core/Collisions/collisionCoordinator';

// Physics constants
export const GRAVITY = -30; // m/s^2, slightly higher than Earth for better game feel
export const PHYSICS_TIMESTEP = 1 / 60; // Fixed timestep for physics

/**
 * Physics world configuration
 */
export interface PhysicsConfig {
  gravity: number;
  maxSubsteps: number;
  fixedTimestep: number;
}

/**
 * Result of a raycast
 */
export interface RaycastResult {
  hit: boolean;
  point: Vector3;
  normal: Vector3;
  distance: number;
  mesh: AbstractMesh | null;
}

/**
 * Character physics body for ground/flight physics
 */
export interface CharacterPhysics {
  position: Vector3;
  velocity: Vector3;
  radius: number;
  height: number;
  isGrounded: boolean;
  groundNormal: Vector3;
}

/**
 * Physics manager - handles all physics simulation
 * Designed to be replaceable with Havok plugin later
 */
export class PhysicsManager {
  private scene: Scene;
  private config: PhysicsConfig;
  private accumulator: number = 0;
  private collisionMeshes: Set<AbstractMesh> = new Set();

  constructor(scene: Scene, config?: Partial<PhysicsConfig>) {
    this.scene = scene;
    this.config = {
      gravity: config?.gravity ?? GRAVITY,
      maxSubsteps: config?.maxSubsteps ?? 4,
      fixedTimestep: config?.fixedTimestep ?? PHYSICS_TIMESTEP,
    };

    // Enable collision system
    scene.collisionsEnabled = true;
  }

  /**
   * Registers a mesh as a collision body
   */
  public addCollisionMesh(mesh: AbstractMesh): void {
    mesh.checkCollisions = true;
    this.collisionMeshes.add(mesh);
  }

  /**
   * Removes a mesh from collision detection
   */
  public removeCollisionMesh(mesh: AbstractMesh): void {
    mesh.checkCollisions = false;
    this.collisionMeshes.delete(mesh);
  }

  /**
   * Performs a raycast against collision meshes
   */
  public raycast(origin: Vector3, direction: Vector3, maxDistance: number): RaycastResult {
    const ray = new Ray(origin, direction.normalize(), maxDistance);

    // Use scene picking with predicate to only hit collision meshes
    const pickInfo = this.scene.pickWithRay(ray, (mesh) => {
      return this.collisionMeshes.has(mesh) && mesh.isPickable;
    });

    if (pickInfo && pickInfo.hit && pickInfo.pickedPoint) {
      return {
        hit: true,
        point: pickInfo.pickedPoint.clone(),
        normal: pickInfo.getNormal(true) ?? Vector3.Up(),
        distance: pickInfo.distance,
        mesh: pickInfo.pickedMesh,
      };
    }

    return {
      hit: false,
      point: origin.add(direction.scale(maxDistance)),
      normal: Vector3.Up(),
      distance: maxDistance,
      mesh: null,
    };
  }

  /**
   * Checks if a point is on/near the ground
   */
  public checkGrounded(position: Vector3, height: number, threshold: number = 0.1): RaycastResult {
    // Cast ray downward from character center
    const origin = position.add(new Vector3(0, height * 0.5, 0));
    const direction = Vector3.Down();
    const maxDistance = (height * 0.5) + threshold;

    return this.raycast(origin, direction, maxDistance);
  }

  /**
   * Performs sphere sweep for collision detection
   * Used for character movement and flight collision
   */
  public sphereSweep(
    start: Vector3,
    end: Vector3,
    radius: number
  ): RaycastResult {
    const direction = end.subtract(start);
    const distance = direction.length();

    if (distance < 0.001) {
      return {
        hit: false,
        point: end.clone(),
        normal: Vector3.Up(),
        distance: 0,
        mesh: null,
      };
    }

    // Simplified: use raycast from multiple points to approximate sphere
    // TODO: Replace with proper sphere sweep when Havok is integrated
    const results: RaycastResult[] = [];

    // Center ray
    results.push(this.raycast(start, direction.normalize(), distance));

    // Offset rays for sphere approximation
    const offsets = [
      new Vector3(radius, 0, 0),
      new Vector3(-radius, 0, 0),
      new Vector3(0, radius, 0),
      new Vector3(0, -radius, 0),
      new Vector3(0, 0, radius),
      new Vector3(0, 0, -radius),
    ];

    for (const offset of offsets) {
      const offsetStart = start.add(offset);
      results.push(this.raycast(offsetStart, direction.normalize(), distance));
    }

    // Return closest hit
    let closestHit: RaycastResult | null = null;
    for (const result of results) {
      if (result.hit) {
        if (!closestHit || result.distance < closestHit.distance) {
          closestHit = result;
        }
      }
    }

    return closestHit ?? {
      hit: false,
      point: end.clone(),
      normal: Vector3.Up(),
      distance,
      mesh: null,
    };
  }

  /**
   * Updates character physics with collision response
   */
  public updateCharacter(
    character: CharacterPhysics,
    velocity: Vector3,
    deltaTime: number
  ): void {
    // Calculate intended movement
    const movement = velocity.scale(deltaTime);
    const targetPosition = character.position.add(movement);

    // Perform collision check
    const sweepResult = this.sphereSweep(
      character.position,
      targetPosition,
      character.radius
    );

    if (sweepResult.hit && sweepResult.distance < movement.length()) {
      // Collision detected - slide along surface
      const penetrationDepth = movement.length() - sweepResult.distance;
      const slideDirection = this.calculateSlideVector(
        movement.normalize(),
        sweepResult.normal
      );

      // Move to contact point, then slide
      character.position = sweepResult.point.subtract(
        movement.normalize().scale(character.radius)
      );
      character.position.addInPlace(slideDirection.scale(penetrationDepth));

      // Adjust velocity to slide along surface
      character.velocity = this.calculateSlideVector(velocity, sweepResult.normal);
    } else {
      // No collision - apply full movement
      character.position = targetPosition;
      character.velocity = velocity;
    }

    // Ground check
    const groundCheck = this.checkGrounded(character.position, character.height);
    character.isGrounded = groundCheck.hit;
    character.groundNormal = groundCheck.normal;

    // Snap to ground if close and moving down
    if (character.isGrounded && velocity.y <= 0) {
      const groundY = groundCheck.point.y;
      if (character.position.y - groundY < character.height * 0.1) {
        character.position.y = groundY;
        if (character.velocity.y < 0) {
          character.velocity.y = 0;
        }
      }
    }
  }

  /**
   * Calculates slide vector along a surface
   */
  private calculateSlideVector(velocity: Vector3, normal: Vector3): Vector3 {
    // Project velocity onto plane defined by normal
    const dot = Vector3.Dot(velocity, normal);
    return velocity.subtract(normal.scale(dot));
  }

  /**
   * Gets gravity value
   */
  public getGravity(): number {
    return this.config.gravity;
  }

  /**
   * Sets gravity value
   */
  public setGravity(gravity: number): void {
    this.config.gravity = gravity;
  }

  /**
   * Fixed timestep physics update
   * Call this with variable deltaTime, it will handle substeps
   */
  public fixedUpdate(
    deltaTime: number,
    updateCallback: (fixedDelta: number) => void
  ): void {
    this.accumulator += deltaTime;

    let substeps = 0;
    while (this.accumulator >= this.config.fixedTimestep && substeps < this.config.maxSubsteps) {
      updateCallback(this.config.fixedTimestep);
      this.accumulator -= this.config.fixedTimestep;
      substeps++;
    }

    // Prevent spiral of death
    if (this.accumulator > this.config.fixedTimestep * 2) {
      this.accumulator = 0;
    }
  }
}

/**
 * Creates a simple collision box for a mesh
 */
export function createCollisionBox(
  mesh: Mesh,
  physicsManager: PhysicsManager
): void {
  mesh.checkCollisions = true;
  mesh.isPickable = true;
  physicsManager.addCollisionMesh(mesh);
}
