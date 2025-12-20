/**
 * Base interface for player states
 * Implements state machine pattern for player movement modes
 */

import type { Player } from './Player';
import type { InputState } from '../input/actionMap';

/**
 * Enum of all possible player states
 */
export enum PlayerStateType {
  Grounded = 'GROUNDED',
  Takeoff = 'TAKEOFF',
  Flight = 'FLIGHT',
  Hover = 'HOVER',
  Landing = 'LANDING',
}

/**
 * Base interface for all player states
 */
export interface IPlayerState {
  /** Type identifier for this state */
  readonly type: PlayerStateType;

  /**
   * Called when entering this state
   */
  enter(player: Player): void;

  /**
   * Called when exiting this state
   */
  exit(player: Player): void;

  /**
   * Called every frame to update state logic
   * Returns the next state type if transitioning, null otherwise
   */
  update(player: Player, input: InputState, deltaTime: number): PlayerStateType | null;

  /**
   * Called every fixed physics timestep
   */
  fixedUpdate(player: Player, input: InputState, fixedDelta: number): void;
}

/**
 * Abstract base class for player states with common functionality
 */
export abstract class BasePlayerState implements IPlayerState {
  abstract readonly type: PlayerStateType;

  enter(_player: Player): void {
    // Override in subclass if needed
  }

  exit(_player: Player): void {
    // Override in subclass if needed
  }

  abstract update(player: Player, input: InputState, deltaTime: number): PlayerStateType | null;

  fixedUpdate(_player: Player, _input: InputState, _fixedDelta: number): void {
    // Override in subclass if needed
  }

  /**
   * Helper to clamp a value between min and max
   */
  protected clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
  }

  /**
   * Helper to lerp between values
   */
  protected lerp(a: number, b: number, t: number): number {
    return a + (b - a) * this.clamp(t, 0, 1);
  }

  /**
   * Helper to apply exponential decay
   */
  protected damp(current: number, target: number, smoothing: number, deltaTime: number): number {
    return this.lerp(current, target, 1 - Math.exp(-smoothing * deltaTime));
  }
}
