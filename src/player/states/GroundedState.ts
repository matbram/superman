/**
 * Grounded State - Player is walking/running on the ground
 */

import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { BasePlayerState, PlayerStateType } from '../PlayerState';
import type { Player } from '../Player';
import type { InputState } from '../../input/actionMap';

// Ground movement constants
const WALK_SPEED = 8; // m/s
const RUN_SPEED = 15; // m/s
const ACCELERATION = 40; // m/s^2
const DECELERATION = 30; // m/s^2
const TURN_SPEED = 10; // radians/s

export class GroundedState extends BasePlayerState {
  readonly type = PlayerStateType.Grounded;

  private moveVelocity: Vector3 = Vector3.Zero();
  private landingGracePeriod: number = 0;
  private lastFlyPressTime: number = 0;
  private flyWasReleased: boolean = true;

  enter(player: Player): void {
    // DON'T snap pitch/roll to 0 instantly - causes camera whip on superhero landing
    // Instead, gradually level out during the grace period
    this.moveVelocity = Vector3.Zero();
    player.setVelocity(new Vector3(0, 0, 0));
    this.landingGracePeriod = 0.3; // Longer grace period for smooth camera transition
  }

  update(player: Player, input: InputState, deltaTime: number): PlayerStateType | null {
    // Update landing grace period
    // Update landing grace period
    if (this.landingGracePeriod > 0) {
      this.landingGracePeriod -= deltaTime;

      // Smoothly level pitch and roll during grace period (prevents camera whip)
      const currentPitch = player.getPitch();
      const currentRoll = player.getRoll();
      const levelRate = 8 * deltaTime; // Fast but smooth
      player.setPitch(currentPitch * Math.max(0, 1 - levelRate));
      player.setRoll(currentRoll * Math.max(0, 1 - levelRate));
    }

    // ── DOUBLE-TAP FLY → INSTANT MAX SPEED TAKEOFF ──
    const now = performance.now();
    if (input.flyTrigger > 0.3 || input.jumpPressed) {
      if (this.flyWasReleased) {
        if (now - this.lastFlyPressTime < 350) {
          // Double tap! Set boost flag so TakeoffState applies max speed
          player.setBoostTakeoff(true);
        }
        this.lastFlyPressTime = now;
        this.flyWasReleased = false;
      }
      return PlayerStateType.Takeoff;
    }
    if (input.flyTrigger < 0.1 && !input.jumpPressed) {
      this.flyWasReleased = true;
    }

    // Check if we've fallen off something
    if (!player.isGrounded()) {
      // Give a small grace period before transitioning to flight
      if (player.getVelocity().y < -5) {
        return PlayerStateType.Flight;
      }
    }

    // Handle movement input (with grace period damping)
    this.handleMovement(player, input, deltaTime);

    // Handle camera rotation from input
    this.handleRotation(player, input, deltaTime);

    return null;
  }

  private handleMovement(player: Player, input: InputState, deltaTime: number): void {
    // When heat vision is active, left stick controls beam aim, not movement
    // Player stands still and aims the beams
    const heatVisionActive = player.isHeatVisionActive();

    // During landing grace period, reduce responsiveness for smooth transition
    const graceFactor = this.landingGracePeriod > 0 ? 0.3 : 1.0;
    const moveSpeed = (input.boostHeld ? RUN_SPEED : WALK_SPEED) * graceFactor;

    // Get camera-relative movement direction
    const cameraForward = player.getCameraForward();
    const cameraRight = player.getCameraRight();

    // Calculate movement direction from input (zero if heat vision active)
    const moveX = heatVisionActive ? 0 : input.moveX;
    const moveY = heatVisionActive ? 0 : input.moveY;

    const inputDir = new Vector3(
      moveX * cameraRight.x + moveY * cameraForward.x,
      0,
      moveX * cameraRight.z + moveY * cameraForward.z
    );

    const inputMagnitude = Math.min(1, Math.sqrt(moveX ** 2 + moveY ** 2)) * graceFactor;

    if (inputMagnitude > 0.01) {
      inputDir.normalize();

      // Accelerate towards target velocity
      const targetVelocity = inputDir.scale(moveSpeed * inputMagnitude);
      this.moveVelocity = Vector3.Lerp(
        this.moveVelocity,
        targetVelocity,
        1 - Math.exp(-ACCELERATION * deltaTime)
      );

      // Rotate player to face movement direction
      const targetAngle = Math.atan2(inputDir.x, inputDir.z);
      const currentAngle = player.getYaw();
      const angleDiff = this.normalizeAngle(targetAngle - currentAngle);
      const newAngle = currentAngle + angleDiff * Math.min(1, TURN_SPEED * deltaTime);
      player.setYaw(newAngle);
    } else {
      // Decelerate to stop
      this.moveVelocity = Vector3.Lerp(
        this.moveVelocity,
        Vector3.Zero(),
        1 - Math.exp(-DECELERATION * deltaTime)
      );
    }

    // Apply velocity
    const velocity = player.getVelocity();
    velocity.x = this.moveVelocity.x;
    velocity.z = this.moveVelocity.z;
    player.setVelocity(velocity);
  }

  private handleRotation(player: Player, input: InputState, deltaTime: number): void {
    // Camera look (mouse/right stick) rotates the camera orbit
    if (Math.abs(input.lookX) > 0.01) {
      player.rotateCameraYaw(input.lookX * 3 * deltaTime);
    }
    if (Math.abs(input.lookY) > 0.01) {
      player.rotateCameraPitch(input.lookY * 2 * deltaTime);
    }
  }

  private normalizeAngle(angle: number): number {
    while (angle > Math.PI) angle -= Math.PI * 2;
    while (angle < -Math.PI) angle += Math.PI * 2;
    return angle;
  }

  fixedUpdate(player: Player, input: InputState, fixedDelta: number): void {
    const velocity = player.getVelocity();

    // During landing grace period, completely stop horizontal movement
    // This prevents physics slide from causing sliding after landing
    if (this.landingGracePeriod > 0) {
      velocity.x = 0;
      velocity.z = 0;
    }

    // If no input and grounded, ensure we're stopped (prevent sliding)
    const inputMag = Math.sqrt(input.moveX ** 2 + input.moveY ** 2);
    if (player.isGrounded() && inputMag < 0.1) {
      // Rapidly damp any residual horizontal velocity
      velocity.x *= 0.8;
      velocity.z *= 0.8;
      if (Math.abs(velocity.x) < 0.1) velocity.x = 0;
      if (Math.abs(velocity.z) < 0.1) velocity.z = 0;
    }

    // Apply gravity if not grounded
    if (!player.isGrounded()) {
      velocity.y += player.getPhysics().getGravity() * fixedDelta;
    } else {
      // Zero vertical velocity when grounded
      velocity.y = 0;
    }

    player.setVelocity(velocity);
  }
}
