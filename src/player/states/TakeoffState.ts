/**
 * Takeoff State - Transition from ground to flight
 * Provides a smooth launch animation/feel
 */

import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { BasePlayerState, PlayerStateType } from '../PlayerState';
import type { Player } from '../Player';
import type { InputState } from '../../input/actionMap';

// Takeoff constants
const TAKEOFF_DURATION = 0.4; // seconds
const TAKEOFF_SPEED = 20; // m/s vertical speed
const TAKEOFF_FORWARD_BOOST = 10; // m/s forward speed boost

export class TakeoffState extends BasePlayerState {
  readonly type = PlayerStateType.Takeoff;

  private timer: number = 0;
  private initialVelocity: Vector3 = Vector3.Zero();

  enter(player: Player): void {
    this.timer = 0;
    this.initialVelocity = player.getVelocity().clone();

    // Enable flight physics immediately (prevents sliding on obstacles)
    player.setFlightMode(true);

    // Check for double-tap boost takeoff
    const isBoosted = player.consumeBoostTakeoff();

    // Apply initial takeoff impulse
    const velocity = player.getVelocity();
    velocity.y = isBoosted ? TAKEOFF_SPEED * 3 : TAKEOFF_SPEED; // Triple height on boost

    // Add forward boost if moving
    const forward = player.getForwardDirection();
    if (this.initialVelocity.length() > 1) {
      velocity.addInPlace(forward.scale(isBoosted ? 220 : TAKEOFF_FORWARD_BOOST));
    } else if (isBoosted) {
      // Even from standing, boost gives forward momentum
      velocity.addInPlace(forward.scale(220));
    }

    player.setVelocity(velocity);
    if (isBoosted) {
      player.setCurrentSpeed(220); // Instant max speed
    }

    // Play takeoff effects
    player.startTakeoffEffect();

    // Boost takeoff gets a shockwave
    if (isBoosted) {
      player.triggerBrakeShockwave(220);
    }
  }

  exit(_player: Player): void {
    // Takeoff complete
  }

  update(player: Player, input: InputState, deltaTime: number): PlayerStateType | null {
    this.timer += deltaTime;

    // Transition to flight after takeoff duration
    if (this.timer >= TAKEOFF_DURATION) {
      // Check if player wants to hover (no fly trigger input)
      if (input.flyTrigger < 0.1) {
        return PlayerStateType.Hover;
      }
      return PlayerStateType.Flight;
    }

    // Smoothly pitch up during takeoff
    const takeoffProgress = this.timer / TAKEOFF_DURATION;
    const targetPitch = -0.3 * Math.sin(takeoffProgress * Math.PI); // Slight upward pitch
    player.setPitch(this.lerp(player.getPitch(), targetPitch, 5 * deltaTime));

    // Allow some control during takeoff
    this.handleInput(player, input, deltaTime);

    return null;
  }

  private handleInput(player: Player, input: InputState, deltaTime: number): void {
    // Reduced control during takeoff
    const controlFactor = 0.5;

    // Camera control
    if (Math.abs(input.lookX) > 0.01) {
      player.rotateCameraYaw(input.lookX * 2 * deltaTime * controlFactor);
    }

    // Slight yaw control
    if (Math.abs(input.moveX) > 0.1) {
      const yaw = player.getYaw();
      player.setYaw(yaw + input.moveX * 2 * deltaTime * controlFactor);
    }
  }

  fixedUpdate(player: Player, _input: InputState, fixedDelta: number): void {
    const velocity = player.getVelocity();

    // Reduce upward velocity over time (transition to controlled flight)
    const takeoffProgress = this.timer / TAKEOFF_DURATION;
    if (takeoffProgress > 0.5) {
      velocity.y *= 0.98;
    }

    // Slight gravity resistance during takeoff
    velocity.y += player.getPhysics().getGravity() * 0.3 * fixedDelta;

    player.setVelocity(velocity);
  }
}
