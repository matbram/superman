/**
 * Input Manager - Unified input handling for gamepad and keyboard/mouse
 * Provides a single interface for all input regardless of device
 */

import {
  InputState,
  createEmptyInputState,
  KeyboardBindings,
  GamepadBindings,
  STICK_DEADZONE,
  MOUSE_SENSITIVITY,
} from './actionMap';

/**
 * Manages all input devices and provides unified input state
 */
export class InputManager {
  private canvas: HTMLCanvasElement;
  private currentState: InputState;

  // Keyboard state
  private keysDown: Set<string> = new Set();
  private keysPressed: Set<string> = new Set();

  // Mouse state
  private mouseDeltaX: number = 0;
  private mouseDeltaY: number = 0;
  private isPointerLocked: boolean = false;

  // Gamepad state
  private previousGamepadButtons: boolean[] = [];

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.currentState = createEmptyInputState();

    this.setupKeyboardListeners();
    this.setupMouseListeners();
    this.setupGamepadListeners();
  }

  /**
   * Sets up keyboard event listeners
   */
  private setupKeyboardListeners(): void {
    window.addEventListener('keydown', (e) => {
      if (!this.keysDown.has(e.code)) {
        this.keysPressed.add(e.code);
      }
      this.keysDown.add(e.code);

      // Prevent default for game keys
      if (this.isGameKey(e.code)) {
        e.preventDefault();
      }
    });

    window.addEventListener('keyup', (e) => {
      this.keysDown.delete(e.code);
    });

    // Clear keys when window loses focus
    window.addEventListener('blur', () => {
      this.keysDown.clear();
      this.keysPressed.clear();
    });
  }

  /**
   * Sets up mouse event listeners
   */
  private setupMouseListeners(): void {
    // Request pointer lock on canvas click
    this.canvas.addEventListener('click', () => {
      if (!this.isPointerLocked) {
        this.canvas.requestPointerLock();
      }
    });

    // Track pointer lock state
    document.addEventListener('pointerlockchange', () => {
      this.isPointerLocked = document.pointerLockElement === this.canvas;
    });

    // Track mouse movement
    document.addEventListener('mousemove', (e) => {
      if (this.isPointerLocked) {
        this.mouseDeltaX += e.movementX;
        this.mouseDeltaY += e.movementY;
      }
    });
  }

  /**
   * Sets up gamepad event listeners
   */
  private setupGamepadListeners(): void {
    window.addEventListener('gamepadconnected', (e) => {
      console.log(`Gamepad connected: ${e.gamepad.id}`);
    });

    window.addEventListener('gamepaddisconnected', () => {
      console.log('Gamepad disconnected');
    });
  }

  /**
   * Checks if a key is used for game controls
   */
  private isGameKey(code: string): boolean {
    const allBindings = Object.values(KeyboardBindings).flat();
    return allBindings.includes(code as never);
  }

  /**
   * Checks if any of the given keys are held
   */
  private isKeyHeld(keys: readonly string[]): boolean {
    return keys.some((key) => this.keysDown.has(key));
  }

  /**
   * Checks if any of the given keys were pressed this frame
   */
  private isKeyPressed(keys: readonly string[]): boolean {
    return keys.some((key) => this.keysPressed.has(key));
  }

  /**
   * Applies dead zone to analog input
   */
  private applyDeadzone(value: number, deadzone: number = STICK_DEADZONE): number {
    if (Math.abs(value) < deadzone) {
      return 0;
    }
    // Remap value outside deadzone to 0-1 range
    const sign = Math.sign(value);
    const adjusted = (Math.abs(value) - deadzone) / (1 - deadzone);
    return sign * Math.min(adjusted, 1);
  }

  /**
   * Gets the current connected gamepad (refreshed)
   */
  private getGamepad(): Gamepad | null {
    // Gamepads need to be polled fresh each frame
    const gamepads = navigator.getGamepads();
    for (const gamepad of gamepads) {
      if (gamepad && gamepad.connected) {
        return gamepad;
      }
    }
    return null;
  }

  /**
   * Updates input state from gamepad
   */
  private updateGamepadState(): void {
    const gamepad = this.getGamepad();
    if (!gamepad) return;

    // Left stick - movement
    this.currentState.moveX = this.applyDeadzone(gamepad.axes[GamepadBindings.leftStickX]);
    this.currentState.moveY = -this.applyDeadzone(gamepad.axes[GamepadBindings.leftStickY]); // Inverted

    // Right stick - camera
    this.currentState.lookX = this.applyDeadzone(gamepad.axes[GamepadBindings.rightStickX]);
    this.currentState.lookY = this.applyDeadzone(gamepad.axes[GamepadBindings.rightStickY]);

    // Triggers - check both button and axis modes
    // Some controllers report triggers as buttons 6/7, others as axes
    if (gamepad.buttons.length > 7) {
      this.currentState.throttle = gamepad.buttons[7]?.value ?? 0;
      this.currentState.brake = gamepad.buttons[6]?.value ?? 0;
    }

    // Buttons
    const jumpButton = gamepad.buttons[GamepadBindings.jump];
    const toggleFlightButton = gamepad.buttons[GamepadBindings.toggleFlight];
    const boostButton = gamepad.buttons[GamepadBindings.boost];

    // Detect button press (not held from last frame)
    const wasJumpPressed = this.previousGamepadButtons[GamepadBindings.jump] ?? false;
    const wasToggleFlightPressed = this.previousGamepadButtons[GamepadBindings.toggleFlight] ?? false;

    this.currentState.jumpHeld = jumpButton?.pressed ?? false;
    this.currentState.jumpPressed = this.currentState.jumpHeld && !wasJumpPressed;

    const toggleFlightHeld = toggleFlightButton?.pressed ?? false;
    this.currentState.toggleFlightPressed = toggleFlightHeld && !wasToggleFlightPressed;

    this.currentState.boostHeld = boostButton?.pressed ?? false;

    // Store button states for next frame
    this.previousGamepadButtons = gamepad.buttons.map((b) => b.pressed);
  }

  /**
   * Updates input state from keyboard/mouse
   */
  private updateKeyboardMouseState(): void {
    // Movement from WASD (only if no gamepad movement)
    if (this.currentState.moveX === 0 && this.currentState.moveY === 0) {
      let moveX = 0;
      let moveY = 0;

      if (this.isKeyHeld(KeyboardBindings.moveForward)) moveY += 1;
      if (this.isKeyHeld(KeyboardBindings.moveBackward)) moveY -= 1;
      if (this.isKeyHeld(KeyboardBindings.moveLeft)) moveX -= 1;
      if (this.isKeyHeld(KeyboardBindings.moveRight)) moveX += 1;

      // Normalize diagonal movement
      const length = Math.sqrt(moveX * moveX + moveY * moveY);
      if (length > 0) {
        this.currentState.moveX = moveX / length;
        this.currentState.moveY = moveY / length;
      }
    }

    // Mouse look (only if pointer locked and no gamepad look)
    if (this.isPointerLocked) {
      if (this.currentState.lookX === 0) {
        this.currentState.lookX = this.mouseDeltaX * MOUSE_SENSITIVITY;
      }
      if (this.currentState.lookY === 0) {
        this.currentState.lookY = this.mouseDeltaY * MOUSE_SENSITIVITY;
      }
    }

    // Keyboard actions
    if (!this.currentState.jumpPressed) {
      this.currentState.jumpPressed = this.isKeyPressed(KeyboardBindings.jump);
    }
    if (!this.currentState.jumpHeld) {
      this.currentState.jumpHeld = this.isKeyHeld(KeyboardBindings.jump);
    }
    if (!this.currentState.toggleFlightPressed) {
      this.currentState.toggleFlightPressed = this.isKeyPressed(KeyboardBindings.toggleFlight);
    }
    if (!this.currentState.boostHeld) {
      this.currentState.boostHeld = this.isKeyHeld(KeyboardBindings.boost);
    }

    // Brake from keyboard (if not from gamepad)
    if (this.currentState.brake === 0) {
      this.currentState.brake = this.isKeyHeld(KeyboardBindings.brake) ? 1 : 0;
    }

    // Throttle from keyboard (forward movement implies throttle in flight)
    if (this.currentState.throttle === 0 && this.currentState.moveY > 0) {
      this.currentState.throttle = this.currentState.moveY;
    }

    // Debug toggle
    this.currentState.debugPressed = this.isKeyPressed(KeyboardBindings.toggleDebug);
  }

  /**
   * Updates input state - call once per frame
   */
  public update(): InputState {
    // Reset current state
    this.currentState = createEmptyInputState();

    // Update from gamepad first (takes priority)
    this.updateGamepadState();

    // Then update from keyboard/mouse (fills in gaps)
    this.updateKeyboardMouseState();

    // Clear frame-specific data
    this.keysPressed.clear();
    this.mouseDeltaX = 0;
    this.mouseDeltaY = 0;

    return this.currentState;
  }

  /**
   * Gets the current input state without updating
   */
  public getState(): InputState {
    return this.currentState;
  }

  /**
   * Checks if a gamepad is connected
   */
  public hasGamepad(): boolean {
    return this.getGamepad() !== null;
  }

  /**
   * Checks if pointer is locked (mouse capture active)
   */
  public hasPointerLock(): boolean {
    return this.isPointerLocked;
  }

  /**
   * Requests pointer lock
   */
  public requestPointerLock(): void {
    this.canvas.requestPointerLock();
  }

  /**
   * Releases pointer lock
   */
  public releasePointerLock(): void {
    document.exitPointerLock();
  }
}
