/**
 * Flight State - Full 3D flight with arcade-style physics
 * Provides powerful, fun flight feel with speed sensation
 */

import { BasePlayerState, PlayerStateType } from '../PlayerState';
import type { Player } from '../Player';
import type { InputState } from '../../input/actionMap';

// Flight physics constants
const BASE_MAX_SPEED = 80; // m/s
const BOOST_MAX_SPEED = 150; // m/s
const BASE_ACCELERATION = 25; // m/s^2
const BOOST_ACCELERATION = 50; // m/s^2
const DECELERATION = 15; // m/s^2 (natural air drag)
const BRAKE_DECELERATION = 40; // m/s^2

// Control constants
const BASE_TURN_RATE = 2.5; // radians/s
const HIGH_SPEED_TURN_RATE = 1.0; // radians/s at max speed
const PITCH_RATE = 2.0; // radians/s
const ROLL_RATE = 3.0; // radians/s
const AUTO_LEVEL_RATE = 1.5; // How fast to auto-level when no input

// Limits
const MAX_PITCH = Math.PI * 0.45; // ~80 degrees
const MAX_ROLL = Math.PI * 0.4; // ~72 degrees

// Speed thresholds
const HOVER_TRANSITION_SPEED = 5; // Below this, can transition to hover
const LANDING_HEIGHT = 3; // Height at which landing can initiate

export class FlightState extends BasePlayerState {
  readonly type = PlayerStateType.Flight;

  private currentSpeed: number = 0;
  private targetSpeed: number = 0;
  private isBoosting: boolean = false;

  enter(player: Player): void {
    // Initialize speed from current velocity
    this.currentSpeed = player.getVelocity().length();
    this.targetSpeed = this.currentSpeed;
    this.isBoosting = false;

    // Enable flight effects
    player.setFlightMode(true);
  }

  exit(player: Player): void {
    player.setFlightMode(false);
    this.isBoosting = false;
  }

  update(player: Player, input: InputState, deltaTime: number): PlayerStateType | null {
    // Check for state transitions
    const transitionState = this.checkTransitions(player, input);
    if (transitionState) return transitionState;

    // Update boost state
    this.isBoosting = input.boostHeld;
    player.setBoostActive(this.isBoosting);

    // Handle flight controls
    this.handleFlightControls(player, input, deltaTime);

    // Update speed
    this.updateSpeed(player, input, deltaTime);

    // Apply movement
    this.applyMovement(player, deltaTime);

    // Update camera
    this.updateCamera(player, input, deltaTime);

    return null;
  }

  private checkTransitions(player: Player, input: InputState): PlayerStateType | null {
    // Land if pressing LT (descend) near ground and moving slowly
    if (input.descendTrigger > 0.5) {
      const height = player.getHeightAboveGround();
      if (height < LANDING_HEIGHT * 2 && this.currentSpeed < 20) {
        return PlayerStateType.Landing;
      }
    }

    // Transition to hover if very slow and no fly trigger - this is the key behavior:
    // Releasing RT should transition to hover, not continue flying
    if (this.currentSpeed < HOVER_TRANSITION_SPEED && input.flyTrigger < 0.1) {
      return PlayerStateType.Hover;
    }

    // Check for ground collision at high speed
    const height = player.getHeightAboveGround();
    if (height < 1 && player.getVelocity().y < -5) {
      // Hard landing - could add damage/stun here
      return PlayerStateType.Landing;
    }

    return null;
  }

  private handleFlightControls(player: Player, input: InputState, deltaTime: number): void {
    // Calculate speed-based turn rate (slower turns at higher speeds)
    const speedFactor = this.currentSpeed / BASE_MAX_SPEED;
    const turnRate = this.lerp(BASE_TURN_RATE, HIGH_SPEED_TURN_RATE, speedFactor);

    // Pitch control - airplane style:
    // Push stick forward (up) = dive down, pull back (down) = climb up
    let targetPitch = player.getPitch();
    if (Math.abs(input.moveY) > 0.1) {
      targetPitch += input.moveY * PITCH_RATE * deltaTime;
    } else {
      // Auto-level pitch gradually when no input
      targetPitch = this.damp(targetPitch, 0, AUTO_LEVEL_RATE, deltaTime);
    }
    player.setPitch(this.clamp(targetPitch, -MAX_PITCH, MAX_PITCH));

    // Yaw control (left/right turning)
    if (Math.abs(input.moveX) > 0.1) {
      const yaw = player.getYaw();
      player.setYaw(yaw + input.moveX * turnRate * deltaTime);
    }

    // Roll based on yaw input (banking into turns)
    let targetRoll = 0;
    if (Math.abs(input.moveX) > 0.1) {
      targetRoll = -input.moveX * MAX_ROLL;
    }
    const currentRoll = player.getRoll();
    const newRoll = this.damp(currentRoll, targetRoll, ROLL_RATE, deltaTime);
    player.setRoll(this.clamp(newRoll, -MAX_ROLL, MAX_ROLL));
  }

  private updateSpeed(player: Player, input: InputState, deltaTime: number): void {
    const maxSpeed = this.isBoosting ? BOOST_MAX_SPEED : BASE_MAX_SPEED;
    const acceleration = this.isBoosting ? BOOST_ACCELERATION : BASE_ACCELERATION;

    // RT (flyTrigger) controls acceleration - analog input for gradual speed control
    if (input.flyTrigger > 0.1) {
      this.targetSpeed = maxSpeed * input.flyTrigger;
    } else {
      // No fly trigger = decelerate to hover
      this.targetSpeed = 0;
    }

    // LT (descendTrigger) acts as brake in flight
    if (input.descendTrigger > 0.1) {
      this.currentSpeed -= BRAKE_DECELERATION * input.descendTrigger * deltaTime;
      this.currentSpeed = Math.max(0, this.currentSpeed);
    } else if (this.currentSpeed < this.targetSpeed) {
      // Accelerating
      this.currentSpeed += acceleration * deltaTime;
      this.currentSpeed = Math.min(this.currentSpeed, this.targetSpeed);
    } else if (this.currentSpeed > this.targetSpeed) {
      // Decelerating
      this.currentSpeed -= DECELERATION * deltaTime;
      this.currentSpeed = Math.max(this.currentSpeed, this.targetSpeed);
    }

    // Update player speed for effects
    player.setCurrentSpeed(this.currentSpeed);
  }

  private applyMovement(player: Player, deltaTime: number): void {
    // Get forward direction based on pitch and yaw
    const forward = player.getForwardDirection();

    // Apply velocity in forward direction
    const velocity = forward.scale(this.currentSpeed);

    // Add slight gravity effect (reduced in flight)
    velocity.y += player.getPhysics().getGravity() * 0.1 * deltaTime;

    player.setVelocity(velocity);
  }

  private updateCamera(player: Player, input: InputState, deltaTime: number): void {
    // Right stick controls camera orbit around player
    if (Math.abs(input.lookX) > 0.01) {
      player.rotateCameraYaw(input.lookX * 3 * deltaTime);
    }
    if (Math.abs(input.lookY) > 0.01) {
      player.rotateCameraPitch(input.lookY * 2 * deltaTime);
    }
  }

  fixedUpdate(_player: Player, _input: InputState, _fixedDelta: number): void {
    // Collision handling is done in Player.update()
    // This is for physics-rate updates if needed
  }

  /**
   * Gets current speed for UI/effects
   */
  public getCurrentSpeed(): number {
    return this.currentSpeed;
  }

  /**
   * Gets whether boost is active
   */
  public getIsBoosting(): boolean {
    return this.isBoosting;
  }
}
