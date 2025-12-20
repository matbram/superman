/**
 * Action Map - Defines the abstract input actions for the game
 * Separates game actions from physical input devices
 */

/**
 * All possible game actions
 */
export enum GameAction {
  // Movement
  MoveForward = 'moveForward',
  MoveBackward = 'moveBackward',
  MoveLeft = 'moveLeft',
  MoveRight = 'moveRight',

  // Flight-specific
  PitchUp = 'pitchUp',
  PitchDown = 'pitchDown',
  YawLeft = 'yawLeft',
  YawRight = 'yawRight',
  RollLeft = 'rollLeft',
  RollRight = 'rollRight',

  // Camera
  LookUp = 'lookUp',
  LookDown = 'lookDown',
  LookLeft = 'lookLeft',
  LookRight = 'lookRight',

  // Actions
  Jump = 'jump',
  ToggleFlight = 'toggleFlight',
  Throttle = 'throttle',
  Brake = 'brake',
  Boost = 'boost',

  // Debug
  ToggleDebug = 'toggleDebug',
}

/**
 * Current state of all input axes and buttons
 */
export interface InputState {
  // Analog axes (0-1 or -1 to 1)
  moveX: number;          // Left/right movement
  moveY: number;          // Forward/backward movement
  lookX: number;          // Camera yaw
  lookY: number;          // Camera pitch
  throttle: number;       // 0-1 throttle amount
  brake: number;          // 0-1 brake amount

  // Button states (pressed this frame)
  jumpPressed: boolean;
  jumpHeld: boolean;
  toggleFlightPressed: boolean;
  boostHeld: boolean;
  debugPressed: boolean;
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
    throttle: 0,
    brake: 0,
    jumpPressed: false,
    jumpHeld: false,
    toggleFlightPressed: false,
    boostHeld: false,
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
  toggleFlight: ['KeyF'],
  boost: ['ShiftLeft', 'ShiftRight'],
  brake: ['ControlLeft', 'ControlRight'],
  toggleDebug: ['Backquote'],
} as const;

/**
 * Gamepad button mappings (standard gamepad layout)
 */
export const GamepadBindings = {
  // Buttons (indices based on standard gamepad mapping)
  jump: 0,              // A button
  toggleFlight: 1,      // B button
  boost: 5,             // RB (right bumper)

  // Axes
  leftStickX: 0,
  leftStickY: 1,
  rightStickX: 2,
  rightStickY: 3,
  leftTrigger: 6,       // Some gamepads use axes for triggers
  rightTrigger: 7,

  // Alternative trigger buttons (if not axes)
  leftTriggerButton: 6,
  rightTriggerButton: 7,
} as const;

/**
 * Dead zone for analog sticks
 */
export const STICK_DEADZONE = 0.15;

/**
 * Mouse sensitivity multiplier
 */
export const MOUSE_SENSITIVITY = 0.002;
