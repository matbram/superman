/**
 * Hover State - Stationary flight with fine control
 * Allows player to look around and choose direction before flying
 */

import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { BasePlayerState, PlayerStateType } from '../PlayerState';
import type { Player } from '../Player';
import type { InputState } from '../../input/actionMap';

// Hover constants
const HOVER_MOVE_SPEED = 10; // m/s for fine movement
const HOVER_ASCEND_SPEED = 8; // m/s vertical
const HOVER_DAMPING = 5; // How quickly hover stabilizes
const HOVER_HEIGHT_MIN = 2; // Minimum hover height

export class HoverState extends BasePlayerState {
  readonly type = PlayerStateType.Hover;

  private hoverVelocity: Vector3 = Vector3.Zero();

  enter(player: Player): void {
    // Slow down to hover
    const velocity = player.getVelocity();
    this.hoverVelocity = velocity.scale(0.3);

    // Level out orientation
    player.setRoll(0);
    player.setBoostActive(false);
    player.setCurrentSpeed(0);
  }

  exit(_player: Player): void {
    // Clean up hover state
  }

  update(player: Player, input: InputState, deltaTime: number): PlayerStateType | null {
    // Check for state transitions
    const transitionState = this.checkTransitions(player, input);
    if (transitionState) return transitionState;

    // Handle hover movement
    this.handleHoverMovement(player, input, deltaTime);

    // Handle camera control
    this.handleCamera(player, input, deltaTime);

    // Stabilize orientation
    this.stabilizeOrientation(player, deltaTime);

    return null;
  }

  private checkTransitions(player: Player, input: InputState): PlayerStateType | null {
    // Transition to flight when pressing RT (flyTrigger)
    if (input.flyTrigger > 0.3) {
      return PlayerStateType.Flight;
    }

    // Transition to flight when boosting
    if (input.boostHeld) {
      return PlayerStateType.Flight;
    }

    // Transition to landing when pressing LT (descendTrigger) near ground
    if (input.descendTrigger > 0.5) {
      const height = player.getHeightAboveGround();
      if (height < 10) {
        return PlayerStateType.Landing;
      }
    }

    // Fall to landing if too close to ground
    const height = player.getHeightAboveGround();
    if (height < HOVER_HEIGHT_MIN && player.getVelocity().y < 0) {
      return PlayerStateType.Landing;
    }

    return null;
  }

  private handleHoverMovement(player: Player, input: InputState, deltaTime: number): void {
    // Get camera-relative directions
    const cameraForward = player.getCameraForward();
    const cameraRight = player.getCameraRight();

    // Calculate target hover velocity
    const targetVelocity = new Vector3(0, 0, 0);

    // Horizontal movement from stick
    if (Math.abs(input.moveX) > 0.1 || Math.abs(input.moveY) > 0.1) {
      const horizontalDir = cameraForward.scale(input.moveY).add(cameraRight.scale(input.moveX));
      horizontalDir.y = 0;
      if (horizontalDir.length() > 0.01) {
        horizontalDir.normalize();
        targetVelocity.addInPlace(horizontalDir.scale(HOVER_MOVE_SPEED));
      }

      // Face movement direction
      const targetYaw = Math.atan2(horizontalDir.x, horizontalDir.z);
      const currentYaw = player.getYaw();
      const angleDiff = this.normalizeAngle(targetYaw - currentYaw);
      player.setYaw(currentYaw + angleDiff * 3 * deltaTime);
    }

    // Vertical movement: jump to ascend, LT (descendTrigger) to descend
    if (input.jumpHeld) {
      targetVelocity.y = HOVER_ASCEND_SPEED;
    } else if (input.descendTrigger > 0.1) {
      targetVelocity.y = -HOVER_ASCEND_SPEED * input.descendTrigger;
    }

    // Smoothly approach target velocity
    this.hoverVelocity = Vector3.Lerp(
      this.hoverVelocity,
      targetVelocity,
      1 - Math.exp(-HOVER_DAMPING * deltaTime)
    );

    // Apply velocity
    player.setVelocity(this.hoverVelocity);
    player.setCurrentSpeed(this.hoverVelocity.length());
  }

  private handleCamera(player: Player, input: InputState, deltaTime: number): void {
    // Free camera look in hover
    if (Math.abs(input.lookX) > 0.01) {
      player.rotateCameraYaw(input.lookX * 3 * deltaTime);
    }
    if (Math.abs(input.lookY) > 0.01) {
      player.rotateCameraPitch(input.lookY * 2 * deltaTime);
    }
  }

  private stabilizeOrientation(player: Player, deltaTime: number): void {
    // Gradually level out roll and pitch
    const roll = player.getRoll();
    const pitch = player.getPitch();

    player.setRoll(this.damp(roll, 0, 3, deltaTime));
    player.setPitch(this.damp(pitch, 0, 2, deltaTime));
  }

  private normalizeAngle(angle: number): number {
    while (angle > Math.PI) angle -= Math.PI * 2;
    while (angle < -Math.PI) angle += Math.PI * 2;
    return angle;
  }

  fixedUpdate(player: Player, _input: InputState, fixedDelta: number): void {
    // Hover has reduced gravity effect
    const velocity = player.getVelocity();

    // Slight gravity, countered by hover force
    const hoverForce = -player.getPhysics().getGravity() * 0.8;
    velocity.y += (player.getPhysics().getGravity() + hoverForce) * fixedDelta;

    player.setVelocity(velocity);
  }
}
