/**
 * Flight State - Full 3D flight with arcade-style physics
 * Provides powerful, fun flight feel with speed sensation
 */

import { BasePlayerState, PlayerStateType } from '../PlayerState';
import type { Player } from '../Player';
import type { InputState } from '../../input/actionMap';

// Flight physics constants - RT pressure controls speed directly
const MIN_SPEED = 10; // m/s - minimum flight speed when RT barely pressed
const MAX_SPEED = 440; // m/s - doubled max speed, trigger sensitivity controls it
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

  // Double-tap tracking
  private lastFlyPressTime: number = 0;
  private flyWasReleased: boolean = true;
  private lastDescendPressTime: number = 0;
  private descendWasReleased: boolean = true;
  private superDiving: boolean = false;

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
    // SUPER DIVE: force landing at any speed when near ground
    if (this.superDiving) {
      const height = player.getHeightAboveGround();
      if (height < 15) { // Higher threshold for fast dive
        this.superDiving = false;
        return PlayerStateType.Landing;
      }
    }

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

    // Pitch control - airplane style (SKIP during super dive)
    let targetPitch = player.getPitch();
    if (this.superDiving) {
      // POSITIVE pitch = nose down in our coordinate system
      targetPitch = Math.PI * 0.45;
    } else if (!heatVisionActive && Math.abs(input.moveY) > 0.1) {
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
    const now = performance.now();
    const DOUBLE_TAP_WINDOW = 350; // ms

    // ── DOUBLE-TAP FLY (RT) → INSTANT MAX SPEED ──
    if (input.flyTrigger > 0.5) {
      if (this.flyWasReleased) {
        // Trigger pressed fresh
        if (now - this.lastFlyPressTime < DOUBLE_TAP_WINDOW) {
          // DOUBLE TAP! Instant max speed + shockwave
          this.currentSpeed = MAX_SPEED;
          this.targetSpeed = MAX_SPEED;
          player.triggerBrakeShockwave(MAX_SPEED); // Sonic boom effect
          this.lastFlyPressTime = 0; // Reset so triple-tap doesn't re-trigger
        } else {
          this.lastFlyPressTime = now;
        }
        this.flyWasReleased = false;
      }
    } else {
      this.flyWasReleased = true;
    }

    // ── DOUBLE-TAP DESCEND (LT) → SUPER DIVE + SUPERHERO LAND ──
    // First tap records time but DOESN'T brake. Second tap within window = dive.
    // If no second tap, brake kicks in after the window expires.
    if (input.descendTrigger > 0.2) {
      if (this.descendWasReleased) {
        if (now - this.lastDescendPressTime < DOUBLE_TAP_WINDOW) {
          // DOUBLE TAP! Super dive straight down
          this.superDiving = true;
          this.lastDescendPressTime = 0;
          this.currentSpeed = Math.max(this.currentSpeed, MAX_SPEED * 0.5);
        } else {
          this.lastDescendPressTime = now;
        }
        this.descendWasReleased = false;
      }
    } else if (input.descendTrigger < 0.1) {
      this.descendWasReleased = true;
    }

    // Super dive mode: pitch straight down, accelerate hard, ignore brakes
    if (this.superDiving) {
      this.currentSpeed = Math.min(MAX_SPEED, this.currentSpeed + 500 * deltaTime);
      player.setPitch(Math.PI * 0.45); // POSITIVE pitch = nose down in our coord system

      // Force velocity downward - override any upward momentum from boost
      const vel = player.getVelocity();
      if (vel.y > 0) {
        vel.y = -Math.abs(vel.y); // Reverse upward velocity to downward
        player.setVelocity(vel);
      }

      player.setCurrentSpeed(this.currentSpeed);
      return; // RETURN EARLY - bypass ALL brake logic
    }

    // RT pressure directly controls target speed
    if (input.flyTrigger > 0.05) {
      const triggerCurve = Math.pow(input.flyTrigger, 1.5);
      this.targetSpeed = MIN_SPEED + (MAX_SPEED - MIN_SPEED) * triggerCurve;
    } else if (!this.superDiving) {
      this.targetSpeed = 0;
    }

    // LT (descendTrigger) acts as HARD brake - BUT only after double-tap window expires
    // This prevents the brake from killing speed before a double-tap can register
    const withinDoubleTapWindow = (now - this.lastDescendPressTime) < DOUBLE_TAP_WINDOW && this.lastDescendPressTime > 0;
    if (input.descendTrigger > 0.1 && !this.superDiving && !withinDoubleTapWindow) {
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
