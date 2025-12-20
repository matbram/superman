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
  isFlying?: boolean;  // When true, don't apply slide behavior on collision
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
  public checkGrounded(position: Vector3, height: number, threshold: number = 0.3): RaycastResult {
    // Cast ray downward from top of character to below feet
    // Position is character CENTER, so we start from top (position + height/2)
    // and cast down to below feet (total distance = height + threshold)
    const origin = position.add(new Vector3(0, height * 0.5, 0));
    const direction = Vector3.Down();
    const maxDistance = height + threshold;

    return this.raycast(origin, direction, maxDistance);
  }

  /**
   * Performs sphere sweep for collision detection
   * Used for character movement and flight collision
   * Uses continuous collision detection for high-speed movement
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

    const normalizedDir = direction.normalize();

    // For high-speed movement, subdivide into smaller steps
    // This prevents tunneling through thin objects
    const maxStepSize = radius * 2;
    const numSteps = Math.max(1, Math.ceil(distance / maxStepSize));
    const stepSize = distance / numSteps;

    let currentStart = start.clone();
    let totalDistance = 0;

    for (let step = 0; step < numSteps; step++) {
      const stepEnd = currentStart.add(normalizedDir.scale(stepSize));
      const stepResult = this.sphereSweepStep(currentStart, stepEnd, radius, normalizedDir, stepSize);

      if (stepResult.hit) {
        stepResult.distance += totalDistance;
        return stepResult;
      }

      currentStart = stepEnd;
      totalDistance += stepSize;
    }

    return {
      hit: false,
      point: end.clone(),
      normal: Vector3.Up(),
      distance,
      mesh: null,
    };
  }

  /**
   * Performs a single step of sphere sweep with comprehensive ray coverage
   */
  private sphereSweepStep(
    start: Vector3,
    end: Vector3,
    radius: number,
    direction: Vector3,
    distance: number
  ): RaycastResult {
    const results: RaycastResult[] = [];
    const checkDist = distance + radius;

    // Center ray
    results.push(this.raycast(start, direction, checkDist));

    // Cardinal direction offsets
    const offsets = [
      new Vector3(radius, 0, 0),
      new Vector3(-radius, 0, 0),
      new Vector3(0, radius, 0),
      new Vector3(0, -radius, 0),
      new Vector3(0, 0, radius),
      new Vector3(0, 0, -radius),
    ];

    // Diagonal offsets for better coverage
    const diagRadius = radius * 0.707;
    offsets.push(
      new Vector3(diagRadius, diagRadius, 0),
      new Vector3(-diagRadius, diagRadius, 0),
      new Vector3(diagRadius, -diagRadius, 0),
      new Vector3(-diagRadius, -diagRadius, 0),
      new Vector3(0, diagRadius, diagRadius),
      new Vector3(0, -diagRadius, diagRadius),
      new Vector3(0, diagRadius, -diagRadius),
      new Vector3(0, -diagRadius, -diagRadius),
      new Vector3(diagRadius, 0, diagRadius),
      new Vector3(-diagRadius, 0, diagRadius),
      new Vector3(diagRadius, 0, -diagRadius),
      new Vector3(-diagRadius, 0, -diagRadius)
    );

    for (const offset of offsets) {
      const offsetStart = start.add(offset);
      results.push(this.raycast(offsetStart, direction, checkDist));
    }

    // Return closest hit
    let closestHit: RaycastResult | null = null;
    for (const result of results) {
      if (result.hit && result.distance < checkDist) {
        if (!closestHit || result.distance < closestHit.distance) {
          closestHit = result;
        }
      }
    }

    if (closestHit) {
      closestHit.distance = Math.max(0, closestHit.distance - radius);
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
    // First, check if we're stuck inside geometry and push out
    this.depenetrateCharacter(character);

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
      // Collision detected - stop at contact point with small buffer
      const safeDistance = Math.max(0, sweepResult.distance - 0.05);
      const movementDir = movement.length() > 0.001 ? movement.normalize() : Vector3.Zero();

      character.position = character.position.add(movementDir.scale(safeDistance));

      if (character.isFlying) {
        // In flight mode: push away from surface, don't slide
        // Keep most of the original velocity but deflect slightly away from surface
        const pushForce = sweepResult.normal.scale(2);
        character.position.addInPlace(pushForce.scale(deltaTime * 10));

        // Preserve velocity direction - player maintains control
        // Just reduce speed slightly on impact
        character.velocity = velocity.scale(0.95);
      } else {
        // Ground mode: slide along surface
        const slideVelocity = this.calculateSlideVector(velocity, sweepResult.normal);
        character.velocity = slideVelocity;

        // Try to apply remaining movement as slide
        const remainingDistance = movement.length() - safeDistance;
        if (remainingDistance > 0.01) {
          const slideMovement = this.calculateSlideVector(movementDir, sweepResult.normal).scale(remainingDistance);
          const slideTarget = character.position.add(slideMovement);

          // Check if slide is safe
          const slideCheck = this.sphereSweep(character.position, slideTarget, character.radius);
          if (!slideCheck.hit || slideCheck.distance >= slideMovement.length()) {
            character.position = slideTarget;
          }
        }
      }
    } else {
      // No collision - apply full movement
      character.position = targetPosition;
      character.velocity = velocity;
    }

    // Ground check (skip ground snapping in flight mode)
    const groundCheck = this.checkGrounded(character.position, character.height);
    character.isGrounded = groundCheck.hit && !character.isFlying;
    character.groundNormal = groundCheck.normal;

    // Snap to ground if close and moving down (only when not flying)
    if (groundCheck.hit && !character.isFlying) {
      const groundY = groundCheck.point.y;
      // Position is character center, so add half height to stand ON the ground
      const targetY = groundY + character.height / 2;

      // Prevent falling through ground - enforce minimum height
      if (character.position.y < targetY) {
        character.position.y = targetY;
        if (character.velocity.y < 0) {
          character.velocity.y = 0;
        }
        character.isGrounded = true;
      }
      // Snap down to ground if close and moving down
      else if (character.position.y < targetY + 0.15 && velocity.y <= 0) {
        character.position.y = targetY;
        if (character.velocity.y < 0) {
          character.velocity.y = 0;
        }
      }
    }

    // Absolute minimum height - never go below ground level 0
    if (!character.isFlying && character.position.y < character.height / 2) {
      character.position.y = character.height / 2;
      if (character.velocity.y < 0) {
        character.velocity.y = 0;
      }
      character.isGrounded = true;
    }
  }

  /**
   * Pushes character out of geometry if stuck inside
   */
  private depenetrateCharacter(character: CharacterPhysics): void {
    // Cast rays in all directions to find penetration
    const directions = [
      new Vector3(1, 0, 0),
      new Vector3(-1, 0, 0),
      new Vector3(0, 1, 0),
      new Vector3(0, -1, 0),
      new Vector3(0, 0, 1),
      new Vector3(0, 0, -1),
    ];

    let pushOut = Vector3.Zero();
    let maxPenetration = 0;

    for (const dir of directions) {
      // Cast ray from inside outward
      const result = this.raycast(character.position, dir, character.radius * 2);

      if (result.hit && result.distance < character.radius) {
        // We're inside geometry in this direction
        const penetration = character.radius - result.distance;
        if (penetration > maxPenetration) {
          maxPenetration = penetration;
          // Push in the direction of the surface normal
          pushOut = result.normal.scale(penetration + 0.1);
        }
      }
    }

    if (maxPenetration > 0) {
      character.position.addInPlace(pushOut);

      // In flight mode: only push position, don't modify velocity (player keeps control)
      // In ground mode: stop velocity in penetration direction
      if (!character.isFlying) {
        const velocityDot = Vector3.Dot(character.velocity, pushOut.normalize());
        if (velocityDot < 0) {
          character.velocity = character.velocity.subtract(pushOut.normalize().scale(velocityDot));
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
