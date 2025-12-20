/**
 * Camera Controller
 * Manages third-person chase camera with dynamic FOV and spring physics
 * Provides speed sensation through camera effects
 */

import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { FreeCamera } from '@babylonjs/core/Cameras/freeCamera';

// Camera configuration
const GROUND_CAMERA_DISTANCE = 8;
const GROUND_CAMERA_HEIGHT = 3;
const FLIGHT_CAMERA_DISTANCE = 12;
const FLIGHT_CAMERA_HEIGHT = 2;

const BASE_FOV = 1.0; // ~57 degrees
const MAX_FOV = 1.4; // ~80 degrees at max speed
const FOV_SPEED_SCALE = 150; // Speed at which max FOV is reached

const CAMERA_SPRING_STIFFNESS = 8;
const CAMERA_SPRING_DAMPING = 4;
const CAMERA_LAG_FACTOR = 0.15; // How much camera lags behind at speed

// Camera orbit limits
const MIN_PITCH = -Math.PI * 0.4; // Looking down
const MAX_PITCH = Math.PI * 0.3; // Looking up

export class CameraController {
  private camera: FreeCamera;

  // Current camera state
  private currentDistance: number = GROUND_CAMERA_DISTANCE;
  private currentHeight: number = GROUND_CAMERA_HEIGHT;
  private currentFOV: number = BASE_FOV;

  // Camera orbit angles (relative to player facing)
  private orbitYaw: number = 0;
  private orbitPitch: number = 0.15; // Slightly looking down

  // Spring physics for smooth follow
  private cameraPosition: Vector3 = Vector3.Zero();
  private cameraVelocity: Vector3 = Vector3.Zero();

  // Target tracking
  private targetPosition: Vector3 = Vector3.Zero();
  private targetForward: Vector3 = new Vector3(0, 0, 1);

  // Mode
  private isFlightMode: boolean = false;
  private speed: number = 0;

  constructor(camera: FreeCamera) {
    this.camera = camera;
    this.cameraPosition = camera.position.clone();
  }

  /**
   * Updates camera target position and orientation
   */
  public setTarget(position: Vector3, forward: Vector3): void {
    this.targetPosition = position;
    this.targetForward = forward;
  }

  /**
   * Sets flight mode (changes camera behavior)
   */
  public setFlightMode(isFlying: boolean): void {
    this.isFlightMode = isFlying;
  }

  /**
   * Sets current speed for FOV and lag calculations
   */
  public setSpeed(speed: number): void {
    this.speed = speed;
  }

  /**
   * Rotates camera orbit yaw
   */
  public rotateYaw(delta: number): void {
    this.orbitYaw += delta;
    // Wrap around
    while (this.orbitYaw > Math.PI) this.orbitYaw -= Math.PI * 2;
    while (this.orbitYaw < -Math.PI) this.orbitYaw += Math.PI * 2;
  }

  /**
   * Rotates camera orbit pitch
   */
  public rotatePitch(delta: number): void {
    this.orbitPitch += delta;
    this.orbitPitch = Math.max(MIN_PITCH, Math.min(MAX_PITCH, this.orbitPitch));
  }

  /**
   * Gets the camera's forward direction (horizontal only)
   */
  public getCameraForward(): Vector3 {
    const forward = this.targetPosition.subtract(this.cameraPosition);
    forward.y = 0;
    return forward.normalize();
  }

  /**
   * Gets the camera's right direction
   */
  public getCameraRight(): Vector3 {
    const forward = this.getCameraForward();
    return Vector3.Cross(Vector3.Up(), forward).normalize();
  }

  /**
   * Updates camera each frame
   */
  public update(deltaTime: number): void {
    // Calculate target camera parameters based on mode
    const targetDistance = this.isFlightMode ? FLIGHT_CAMERA_DISTANCE : GROUND_CAMERA_DISTANCE;
    const targetHeight = this.isFlightMode ? FLIGHT_CAMERA_HEIGHT : GROUND_CAMERA_HEIGHT;

    // Smooth transition between modes
    this.currentDistance = this.lerp(this.currentDistance, targetDistance, 3 * deltaTime);
    this.currentHeight = this.lerp(this.currentHeight, targetHeight, 3 * deltaTime);

    // Update FOV based on speed
    const speedRatio = Math.min(1, this.speed / FOV_SPEED_SCALE);
    const targetFOV = BASE_FOV + (MAX_FOV - BASE_FOV) * speedRatio * speedRatio;
    this.currentFOV = this.lerp(this.currentFOV, targetFOV, 5 * deltaTime);
    this.camera.fov = this.currentFOV;

    // Calculate camera lag based on speed (camera trails behind more at high speed)
    const lagDistance = this.speed * CAMERA_LAG_FACTOR;

    // Calculate ideal camera position
    const idealOffset = this.calculateCameraOffset();
    const lagOffset = this.targetForward.scale(-lagDistance);
    const idealPosition = this.targetPosition.add(idealOffset).add(lagOffset);

    // Apply spring physics for smooth following
    this.applyCameraSpring(idealPosition, deltaTime);

    // Update camera position
    this.camera.position.copyFrom(this.cameraPosition);

    // Look at target (slightly ahead of player)
    const lookAhead = this.targetForward.scale(this.speed * 0.05);
    const lookTarget = this.targetPosition.add(new Vector3(0, 1, 0)).add(lookAhead);
    this.camera.setTarget(lookTarget);
  }

  /**
   * Calculates camera offset from target based on orbit angles
   */
  private calculateCameraOffset(): Vector3 {
    // Combine player facing with orbit offset
    const baseYaw = Math.atan2(this.targetForward.x, this.targetForward.z);
    const combinedYaw = baseYaw + this.orbitYaw;

    // Calculate offset position
    const horizontalDist = Math.cos(this.orbitPitch) * this.currentDistance;
    const verticalDist = Math.sin(this.orbitPitch) * this.currentDistance + this.currentHeight;

    return new Vector3(
      -Math.sin(combinedYaw) * horizontalDist,
      verticalDist,
      -Math.cos(combinedYaw) * horizontalDist
    );
  }

  /**
   * Applies spring physics for smooth camera movement
   */
  private applyCameraSpring(targetPos: Vector3, deltaTime: number): void {
    // Spring force
    const displacement = targetPos.subtract(this.cameraPosition);
    const springForce = displacement.scale(CAMERA_SPRING_STIFFNESS);

    // Damping force
    const dampingForce = this.cameraVelocity.scale(-CAMERA_SPRING_DAMPING);

    // Total acceleration
    const acceleration = springForce.add(dampingForce);

    // Integrate
    this.cameraVelocity.addInPlace(acceleration.scale(deltaTime));
    this.cameraPosition.addInPlace(this.cameraVelocity.scale(deltaTime));
  }

  /**
   * Resets camera to default position behind player
   */
  public resetToDefault(position: Vector3, forward: Vector3): void {
    this.targetPosition = position;
    this.targetForward = forward;
    this.orbitYaw = 0;
    this.orbitPitch = 0.15;

    const offset = this.calculateCameraOffset();
    this.cameraPosition = position.add(offset);
    this.cameraVelocity = Vector3.Zero();
    this.camera.position.copyFrom(this.cameraPosition);
  }

  private lerp(a: number, b: number, t: number): number {
    return a + (b - a) * Math.min(1, Math.max(0, t));
  }

  /**
   * Adds screen shake effect
   */
  public addShake(intensity: number): void {
    const shakeOffset = new Vector3(
      (Math.random() - 0.5) * intensity,
      (Math.random() - 0.5) * intensity,
      (Math.random() - 0.5) * intensity
    );
    this.cameraVelocity.addInPlace(shakeOffset);
  }
}
