/**
 * Landing State - Smooth transition from flight to ground
 * Handles deceleration and orientation reset for landing
 */

import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { BasePlayerState, PlayerStateType } from '../PlayerState';
import type { Player } from '../Player';
import type { InputState } from '../../input/actionMap';

// Landing constants
const LANDING_DECEL = 30; // m/s^2
const LANDING_DESCENT_SPEED = 5; // m/s
const LANDING_LEVEL_RATE = 5; // How fast to level orientation

export class LandingState extends BasePlayerState {
  readonly type = PlayerStateType.Landing;

  private horizontalVelocity: Vector3 = Vector3.Zero();

  enter(player: Player): void {
    const velocity = player.getVelocity();
    this.horizontalVelocity = new Vector3(velocity.x, 0, velocity.z);

    player.setFlightMode(false);
    player.setBoostActive(false);

    // Clamp position above ground
    const pos = player.getPhysics().position;
    if (pos.y < 0.9) pos.y = 0.9;
  }

  exit(player: Player): void {
    // Clear all velocity when landing completes to prevent sliding
    player.setVelocity(new Vector3(0, 0, 0));
    this.horizontalVelocity = Vector3.Zero();
    // Ensure player is properly grounded
    player.setCurrentSpeed(0);
  }

  update(player: Player, input: InputState, deltaTime: number): PlayerStateType | null {
    // Check for abort landing (take off again) - press RT or jump
    if (input.jumpPressed || input.flyTrigger > 0.3) {
      return PlayerStateType.Takeoff;
    }

    // Check if landed
    if (player.isGrounded()) {
      // Landed successfully
      return PlayerStateType.Grounded;
    }

    // Handle landing approach
    this.handleLanding(player, input, deltaTime);

    // Level orientation
    this.levelOrientation(player, deltaTime);

    return null;
  }

  private handleLanding(player: Player, _input: InputState, deltaTime: number): void {
    // Slow horizontal velocity
    const decelAmount = LANDING_DECEL * deltaTime;
    const horizontalSpeed = this.horizontalVelocity.length();

    if (horizontalSpeed > decelAmount) {
      const decelDir = this.horizontalVelocity.normalize().scale(-decelAmount);
      this.horizontalVelocity.addInPlace(decelDir);
    } else {
      this.horizontalVelocity = Vector3.Zero();
    }

    // Calculate descent velocity
    const height = player.getHeightAboveGround();
    let descentSpeed = LANDING_DESCENT_SPEED;

    // Slow down near ground for soft landing
    if (height < 2) {
      descentSpeed = Math.max(1, descentSpeed * (height / 2));
    }

    // Apply velocity
    const velocity = this.horizontalVelocity.clone();
    velocity.y = -descentSpeed;
    player.setVelocity(velocity);

    // Update speed display
    player.setCurrentSpeed(velocity.length());

    // Face forward (in direction of horizontal movement or current facing)
    if (this.horizontalVelocity.length() > 1) {
      const targetYaw = Math.atan2(this.horizontalVelocity.x, this.horizontalVelocity.z);
      const currentYaw = player.getYaw();
      const angleDiff = this.normalizeAngle(targetYaw - currentYaw);
      player.setYaw(currentYaw + angleDiff * 2 * deltaTime);
    }
  }

  private levelOrientation(player: Player, deltaTime: number): void {
    // Smoothly level roll and pitch
    const roll = player.getRoll();
    const pitch = player.getPitch();

    player.setRoll(this.damp(roll, 0, LANDING_LEVEL_RATE, deltaTime));
    player.setPitch(this.damp(pitch, 0, LANDING_LEVEL_RATE, deltaTime));
  }

  private normalizeAngle(angle: number): number {
    while (angle > Math.PI) angle -= Math.PI * 2;
    while (angle < -Math.PI) angle += Math.PI * 2;
    return angle;
  }

  fixedUpdate(player: Player, _input: InputState, fixedDelta: number): void {
    // Apply reduced gravity during controlled descent
    const velocity = player.getVelocity();
    const gravityEffect = player.getPhysics().getGravity() * 0.3;
    velocity.y += gravityEffect * fixedDelta;

    // Clamp descent speed
    velocity.y = Math.max(velocity.y, -LANDING_DESCENT_SPEED * 2);

    player.setVelocity(velocity);
  }
}
