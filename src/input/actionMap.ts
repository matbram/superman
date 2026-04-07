/**
 * Action Map - Defines the abstract input actions for the game
 *
 * CONTROL SCHEME:
 * - Left Stick: Movement (ground) / Direction (flight)
 * - Right Stick: Camera control only
 * - RT (Right Trigger): Fly / Accelerate (analog)
 * - LT (Left Trigger): Descend (analog)
 * - A: Jump (ground only)
 * - RB: Boost (while flying)
 */

/**
 * Current state of all input axes and buttons
 */
export interface InputState {
  // Analog axes (-1 to 1)
  moveX: number;          // Left stick horizontal - strafe/turn
  moveY: number;          // Left stick vertical - forward/back
  lookX: number;          // Right stick horizontal - camera yaw
  lookY: number;          // Right stick vertical - camera pitch

  // Analog triggers (0 to 1)
  flyTrigger: number;     // RT - fly/accelerate (0 = none, 1 = full)
  descendTrigger: number; // LT - descend (0 = none, 1 = full)

  // Button states
  jumpPressed: boolean;   // A button - just pressed this frame
  jumpHeld: boolean;      // A button - held down
  boostHeld: boolean;     // RB - boost while flying
  heatVisionHeld: boolean; // LB - heat vision (laser eyes)
  superBreathHeld: boolean; // Y button / F key - super breath
  debugPressed: boolean;  // Backtick - toggle debug
}

/**
 * Creates a default empty input state
 */
export function createEmptyInputState(): InputState {
  return {
    moveX: 0,
    moveY: 0,
    lookX: 0,
    lookY: 0,
    flyTrigger: 0,
    descendTrigger: 0,
    jumpPressed: false,
    jumpHeld: false,
    boostHeld: false,
    heatVisionHeld: false,
    superBreathHeld: false,
    debugPressed: false,
  };
}

/**
 * Keyboard key bindings
 */
export const KeyboardBindings = {
  moveForward: ['KeyW', 'ArrowUp'],
  moveBackward: ['KeyS', 'ArrowDown'],
  moveLeft: ['KeyA', 'ArrowLeft'],
  moveRight: ['KeyD', 'ArrowRight'],
  jump: ['Space'],
  fly: ['ShiftLeft', 'ShiftRight'],  // Shift to fly (like RT)
  descend: ['ControlLeft', 'ControlRight'],  // Ctrl to descend (like LT)
  boost: ['KeyQ'],  // Q for boost
  heatVision: ['KeyE'],  // E for heat vision (laser eyes)
  toggleDebug: ['Backquote'],
} as const;

/**
 * Gamepad button mappings (standard gamepad layout)
 * Standard mapping: https://w3c.github.io/gamepad/#remapping
 */
export const GamepadBindings = {
  // Face buttons
  jump: 0,              // A button (bottom)
  boost: 5,             // RB (right bumper)
  heatVision: 4,        // LB (left bumper) - heat vision

  // Sticks
  leftStickX: 0,
  leftStickY: 1,
  rightStickX: 2,
  rightStickY: 3,

  // Triggers (buttons 6 and 7 in standard mapping)
  leftTriggerButton: 6,   // LT
  rightTriggerButton: 7,  // RT
} as const;

/**
 * Dead zone for analog sticks
 */
export const STICK_DEADZONE = 0.15;

/**
 * Mouse sensitivity multiplier
 */
export const MOUSE_SENSITIVITY = 0.003;
