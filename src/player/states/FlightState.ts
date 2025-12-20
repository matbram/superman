/**
 * Flight State - Full 3D flight with arcade-style physics
 * Provides powerful, fun flight feel with speed sensation
 */

import { BasePlayerState, PlayerStateType } from '../PlayerState';
import type { Player } from '../Player';
import type { InputState } from '../../input/actionMap';

// Flight physics constants - RT pressure controls speed directly
const MIN_SPEED = 10; // m/s - minimum flight speed when RT barely pressed
const MAX_SPEED = 220; // m/s - supersonic speed at full RT pressure
const ACCELERATION = 60; // m/s^2 - how fast we reach target speed
const DECELERATION = 30; // m/s^2 (natural air drag when releasing RT)
const BRAKE_DECELERATION = 200; // m/s^2 - abrupt stop with LT

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
const BRAKE_SHOCKWAVE_THRESHOLD = 100; // Speed above which hard braking triggers shockwave

export class FlightState extends BasePlayerState {
  readonly type = PlayerStateType.Flight;

  private currentSpeed: number = 0;
  private targetSpeed: number = 0;
  private wasAboveBrakeThreshold: boolean = false;
  private brakeShockwaveTriggered: boolean = false;

  enter(player: Player): void {
    // Initialize speed from current velocity
    this.currentSpeed = player.getVelocity().length();
    this.targetSpeed = this.currentSpeed;

    // Reset brake shockwave tracking
    this.wasAboveBrakeThreshold = this.currentSpeed > BRAKE_SHOCKWAVE_THRESHOLD;
    this.brakeShockwaveTriggered = false;

    // Enable flight effects
    player.setFlightMode(true);
    player.setBoostActive(false);
  }

  exit(player: Player): void {
    player.setFlightMode(false);
  }

  update(player: Player, input: InputState, deltaTime: number): PlayerStateType | null {
    // Check for state transitions
    const transitionState = this.checkTransitions(player, input);
    if (transitionState) return transitionState;

    // Handle flight controls
    this.handleFlightControls(player, input, deltaTime);

    // Update speed based on RT pressure
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

    // Transition to hover if very slow and no fly trigger
    if (this.currentSpeed < HOVER_TRANSITION_SPEED && input.flyTrigger < 0.1) {
      return PlayerStateType.Hover;
    }

    // Check for ground collision at high speed
    const height = player.getHeightAboveGround();
    if (height < 1 && player.getVelocity().y < -5) {
      return PlayerStateType.Landing;
    }

    return null;
  }

  private handleFlightControls(player: Player, input: InputState, deltaTime: number): void {
    // When heat vision is active, left stick controls beam aim, not movement
    // Still allow auto-leveling and camera control
    const heatVisionActive = player.isHeatVisionActive();

    // Calculate speed-based turn rate (slower turns at higher speeds)
    const speedFactor = this.currentSpeed / MAX_SPEED;
    const turnRate = this.lerp(BASE_TURN_RATE, HIGH_SPEED_TURN_RATE, speedFactor);

    // Pitch control - airplane style:
    // Push stick forward (up) = dive down, pull back (down) = climb up
    let targetPitch = player.getPitch();
    if (!heatVisionActive && Math.abs(input.moveY) > 0.1) {
      targetPitch += input.moveY * PITCH_RATE * deltaTime;
    } else {
      // Auto-level pitch gradually when no input or heat vision active
      targetPitch = this.damp(targetPitch, 0, AUTO_LEVEL_RATE, deltaTime);
    }
    player.setPitch(this.clamp(targetPitch, -MAX_PITCH, MAX_PITCH));

    // Yaw control (left/right turning) - disabled during heat vision
    if (!heatVisionActive && Math.abs(input.moveX) > 0.1) {
      const yaw = player.getYaw();
      player.setYaw(yaw + input.moveX * turnRate * deltaTime);
    }

    // Roll based on yaw input (banking into turns)
    let targetRoll = 0;
    if (!heatVisionActive && Math.abs(input.moveX) > 0.1) {
      targetRoll = -input.moveX * MAX_ROLL;
    }
    const currentRoll = player.getRoll();
    const newRoll = this.damp(currentRoll, targetRoll, ROLL_RATE, deltaTime);
    player.setRoll(this.clamp(newRoll, -MAX_ROLL, MAX_ROLL));
  }

  private updateSpeed(player: Player, input: InputState, deltaTime: number): void {
    const previousSpeed = this.currentSpeed;

    // RT pressure directly controls target speed (procedural acceleration)
    // More pressure = faster speed, proportional to trigger position
    if (input.flyTrigger > 0.05) {
      // Map trigger pressure to speed range
      // Use a curve for better feel: slight press = slow, full press = max
      const triggerCurve = Math.pow(input.flyTrigger, 1.5); // Slight exponential curve
      this.targetSpeed = MIN_SPEED + (MAX_SPEED - MIN_SPEED) * triggerCurve;
    } else {
      // No fly trigger = decelerate to hover
      this.targetSpeed = 0;
    }

    // LT (descendTrigger) acts as HARD brake - abrupt stop
    if (input.descendTrigger > 0.1) {
      this.currentSpeed -= BRAKE_DECELERATION * input.descendTrigger * deltaTime;
      this.currentSpeed = Math.max(0, this.currentSpeed);

      // If fully pressing LT while above threshold speed, trigger brake shockwave
      if (input.descendTrigger > 0.7 && this.wasAboveBrakeThreshold && !this.brakeShockwaveTriggered) {
        player.triggerBrakeShockwave(previousSpeed);
        this.brakeShockwaveTriggered = true;
      }

      // If fully pressing LT, stop almost immediately
      if (input.descendTrigger > 0.8) {
        this.currentSpeed *= 0.7;
      }
    } else if (this.currentSpeed < this.targetSpeed) {
      // Accelerating towards target
      this.currentSpeed += ACCELERATION * deltaTime;
      this.currentSpeed = Math.min(this.currentSpeed, this.targetSpeed);
    } else if (this.currentSpeed > this.targetSpeed) {
      // Decelerating towards target
      this.currentSpeed -= DECELERATION * deltaTime;
      this.currentSpeed = Math.max(this.currentSpeed, this.targetSpeed);
    }

    // Track if we were above brake threshold for shockwave triggering
    if (this.currentSpeed > BRAKE_SHOCKWAVE_THRESHOLD) {
      this.wasAboveBrakeThreshold = true;
      this.brakeShockwaveTriggered = false; // Reset so it can trigger again
    } else if (this.currentSpeed < BRAKE_SHOCKWAVE_THRESHOLD * 0.5) {
      // Reset tracking when we've slowed down significantly
      this.wasAboveBrakeThreshold = false;
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
  }

  public getCurrentSpeed(): number {
    return this.currentSpeed;
  }
}
