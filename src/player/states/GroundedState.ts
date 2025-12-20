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

  enter(player: Player): void {
    // Reset flight-specific state when landing
    player.setRoll(0);
    player.setPitch(0);
    // Reset movement velocity to prevent carrying over flight momentum
    this.moveVelocity = Vector3.Zero();
    // Completely zero all velocity to prevent any sliding
    player.setVelocity(new Vector3(0, 0, 0));
    // Small grace period where controls are slightly damped for smooth landing
    this.landingGracePeriod = 0.15;
  }

  update(player: Player, input: InputState, deltaTime: number): PlayerStateType | null {
    // Update landing grace period
    if (this.landingGracePeriod > 0) {
      this.landingGracePeriod -= deltaTime;
    }

    // Check for state transitions
    // Jump or press RT (fly trigger) to take off
    if (input.jumpPressed || input.flyTrigger > 0.3) {
      return PlayerStateType.Takeoff;
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
    // During landing grace period, reduce responsiveness for smooth transition
    const graceFactor = this.landingGracePeriod > 0 ? 0.3 : 1.0;
    const moveSpeed = (input.boostHeld ? RUN_SPEED : WALK_SPEED) * graceFactor;

    // Get camera-relative movement direction
    const cameraForward = player.getCameraForward();
    const cameraRight = player.getCameraRight();

    // Calculate movement direction from input
    const inputDir = new Vector3(
      input.moveX * cameraRight.x + input.moveY * cameraForward.x,
      0,
      input.moveX * cameraRight.z + input.moveY * cameraForward.z
    );

    const inputMagnitude = Math.min(1, Math.sqrt(input.moveX ** 2 + input.moveY ** 2)) * graceFactor;

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

  fixedUpdate(player: Player, _input: InputState, fixedDelta: number): void {
    const velocity = player.getVelocity();

    // Apply gravity if not grounded
    if (!player.isGrounded()) {
      velocity.y += player.getPhysics().getGravity() * fixedDelta;
    } else {
      // Keep small downward velocity to maintain ground contact
      velocity.y = Math.max(velocity.y, -1);
    }

    player.setVelocity(velocity);
  }
}
