/**
 * Input Manager - Unified input handling for gamepad and keyboard/mouse
 * Provides a single interface for all input regardless of device
 *
 * CONTROL SCHEME:
 * - Left Stick / WASD: Movement direction
 * - Right Stick / Mouse: Camera control
 * - RT / Shift: Fly and accelerate
 * - LT / Ctrl: Descend
 * - A / Space: Jump (ground)
 * - RB / Q: Boost (flight)
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

  private setupKeyboardListeners(): void {
    window.addEventListener('keydown', (e) => {
      if (!this.keysDown.has(e.code)) {
        this.keysPressed.add(e.code);
      }
      this.keysDown.add(e.code);

      if (this.isGameKey(e.code)) {
        e.preventDefault();
      }
    });

    window.addEventListener('keyup', (e) => {
      this.keysDown.delete(e.code);
    });

    window.addEventListener('blur', () => {
      this.keysDown.clear();
      this.keysPressed.clear();
    });
  }

  private setupMouseListeners(): void {
    this.canvas.addEventListener('click', () => {
      if (!this.isPointerLocked) {
        this.canvas.requestPointerLock();
      }
    });

    document.addEventListener('pointerlockchange', () => {
      this.isPointerLocked = document.pointerLockElement === this.canvas;
    });

    document.addEventListener('mousemove', (e) => {
      if (this.isPointerLocked) {
        this.mouseDeltaX += e.movementX;
        this.mouseDeltaY += e.movementY;
      }
    });
  }

  // Debug: track if we've logged button layout
  private hasLoggedButtons: boolean = false;

  private setupGamepadListeners(): void {
    window.addEventListener('gamepadconnected', (e) => {
      console.log(`Gamepad connected: ${e.gamepad.id}`);
      console.log(`Gamepad has ${e.gamepad.buttons.length} buttons and ${e.gamepad.axes.length} axes`);
    });

    window.addEventListener('gamepaddisconnected', () => {
      console.log('Gamepad disconnected');
      this.hasLoggedButtons = false;
    });
  }

  private isGameKey(code: string): boolean {
    const allBindings = Object.values(KeyboardBindings).flat();
    return allBindings.includes(code as never);
  }

  private isKeyHeld(keys: readonly string[]): boolean {
    return keys.some((key) => this.keysDown.has(key));
  }

  private isKeyPressed(keys: readonly string[]): boolean {
    return keys.some((key) => this.keysPressed.has(key));
  }

  private applyDeadzone(value: number, deadzone: number = STICK_DEADZONE): number {
    if (Math.abs(value) < deadzone) {
      return 0;
    }
    const sign = Math.sign(value);
    const adjusted = (Math.abs(value) - deadzone) / (1 - deadzone);
    return sign * Math.min(adjusted, 1);
  }

  private getGamepad(): Gamepad | null {
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

    // Left stick - movement direction
    this.currentState.moveX = this.applyDeadzone(gamepad.axes[GamepadBindings.leftStickX]);
    this.currentState.moveY = -this.applyDeadzone(gamepad.axes[GamepadBindings.leftStickY]); // Inverted

    // Right stick - camera only
    this.currentState.lookX = this.applyDeadzone(gamepad.axes[GamepadBindings.rightStickX]);
    this.currentState.lookY = this.applyDeadzone(gamepad.axes[GamepadBindings.rightStickY]);

    // Triggers - RT for fly, LT for descend
    if (gamepad.buttons.length > 7) {
      // RT (button 7) - fly/accelerate
      this.currentState.flyTrigger = gamepad.buttons[GamepadBindings.rightTriggerButton]?.value ?? 0;
      // LT (button 6) - descend
      this.currentState.descendTrigger = gamepad.buttons[GamepadBindings.leftTriggerButton]?.value ?? 0;
    }

    // Face buttons
    const jumpButton = gamepad.buttons[GamepadBindings.jump];
    const boostButton = gamepad.buttons[GamepadBindings.boost];
    const heatVisionButton = gamepad.buttons[GamepadBindings.heatVision];
    const lockOnButton = gamepad.buttons[GamepadBindings.lockOn];
    const pauseButton = gamepad.buttons[GamepadBindings.pause];

    // Detect button press (not held from last frame)
    const wasJumpPressed = this.previousGamepadButtons[GamepadBindings.jump] ?? false;
    const wasLockOnPressed = this.previousGamepadButtons[GamepadBindings.lockOn] ?? false;
    const wasPausePressed = this.previousGamepadButtons[GamepadBindings.pause] ?? false;

    this.currentState.jumpHeld = jumpButton?.pressed ?? false;
    this.currentState.jumpPressed = this.currentState.jumpHeld && !wasJumpPressed;
    this.currentState.boostHeld = boostButton?.pressed ?? false;
    this.currentState.heatVisionHeld = heatVisionButton?.pressed ?? false;

    const lockOnHeld = lockOnButton?.pressed ?? false;
    this.currentState.lockOnPressed = lockOnHeld && !wasLockOnPressed;

    // Support both button 8 (Share/Create) and button 9 (Options) for pause
    // Some controllers have different mappings
    const pauseButton8 = gamepad.buttons[8];
    const pauseHeld = (pauseButton?.pressed ?? false) || (pauseButton8?.pressed ?? false);
    const wasPausePressed8 = this.previousGamepadButtons[8] ?? false;
    this.currentState.pausePressed = pauseHeld && !wasPausePressed && !wasPausePressed8;

    // Debug: log any button presses to help diagnose controller issues
    if (!this.hasLoggedButtons) {
      const pressedButtons: number[] = [];
      gamepad.buttons.forEach((btn, idx) => {
        if (btn.pressed) pressedButtons.push(idx);
      });
      if (pressedButtons.length > 0) {
        console.log('[Gamepad] Buttons pressed:', pressedButtons);
        this.hasLoggedButtons = true;
        // Reset after 1 second to allow more logging
        setTimeout(() => { this.hasLoggedButtons = false; }, 1000);
      }
    }

    // Menu navigation (D-pad and face buttons)
    const dpadUpButton = gamepad.buttons[GamepadBindings.dpadUp];
    const dpadDownButton = gamepad.buttons[GamepadBindings.dpadDown];
    const selectButton = gamepad.buttons[GamepadBindings.select];
    const backButton = gamepad.buttons[GamepadBindings.back];

    const wasDpadUpPressed = this.previousGamepadButtons[GamepadBindings.dpadUp] ?? false;
    const wasDpadDownPressed = this.previousGamepadButtons[GamepadBindings.dpadDown] ?? false;
    const wasSelectPressed = this.previousGamepadButtons[GamepadBindings.select] ?? false;
    const wasBackPressed = this.previousGamepadButtons[GamepadBindings.back] ?? false;

    const dpadUpHeld = dpadUpButton?.pressed ?? false;
    const dpadDownHeld = dpadDownButton?.pressed ?? false;
    const selectHeld = selectButton?.pressed ?? false;
    const backHeld = backButton?.pressed ?? false;

    this.currentState.menuUp = dpadUpHeld && !wasDpadUpPressed;
    this.currentState.menuDown = dpadDownHeld && !wasDpadDownPressed;
    this.currentState.menuSelect = selectHeld && !wasSelectPressed;
    this.currentState.menuBack = backHeld && !wasBackPressed;

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

    // Mouse look (only if pointer locked)
    if (this.isPointerLocked) {
      // Always add mouse to look, don't overwrite gamepad
      this.currentState.lookX += this.mouseDeltaX * MOUSE_SENSITIVITY;
      this.currentState.lookY += this.mouseDeltaY * MOUSE_SENSITIVITY;
    }

    // Keyboard buttons
    if (!this.currentState.jumpPressed) {
      this.currentState.jumpPressed = this.isKeyPressed(KeyboardBindings.jump);
    }
    if (!this.currentState.jumpHeld) {
      this.currentState.jumpHeld = this.isKeyHeld(KeyboardBindings.jump);
    }
    if (!this.currentState.boostHeld) {
      this.currentState.boostHeld = this.isKeyHeld(KeyboardBindings.boost);
    }
    if (!this.currentState.heatVisionHeld) {
      this.currentState.heatVisionHeld = this.isKeyHeld(KeyboardBindings.heatVision);
    }

    // Fly trigger from keyboard (Shift = full fly)
    if (this.currentState.flyTrigger === 0) {
      this.currentState.flyTrigger = this.isKeyHeld(KeyboardBindings.fly) ? 1 : 0;
    }

    // Descend trigger from keyboard (Ctrl = full descend)
    if (this.currentState.descendTrigger === 0) {
      this.currentState.descendTrigger = this.isKeyHeld(KeyboardBindings.descend) ? 1 : 0;
    }

    // Lock-on toggle (Tab)
    if (!this.currentState.lockOnPressed) {
      this.currentState.lockOnPressed = this.isKeyPressed(KeyboardBindings.lockOn);
    }

    // Debug toggle
    this.currentState.debugPressed = this.isKeyPressed(KeyboardBindings.toggleDebug);

    // Pause toggle (Escape)
    if (!this.currentState.pausePressed) {
      this.currentState.pausePressed = this.isKeyPressed(KeyboardBindings.pause);
    }

    // Menu navigation (keyboard)
    if (!this.currentState.menuUp) {
      this.currentState.menuUp = this.isKeyPressed(KeyboardBindings.menuUp);
    }
    if (!this.currentState.menuDown) {
      this.currentState.menuDown = this.isKeyPressed(KeyboardBindings.menuDown);
    }
    if (!this.currentState.menuSelect) {
      this.currentState.menuSelect = this.isKeyPressed(KeyboardBindings.menuSelect);
    }
    if (!this.currentState.menuBack) {
      this.currentState.menuBack = this.isKeyPressed(KeyboardBindings.menuBack);
    }
  }

  /**
   * Updates input state - call once per frame
   */
  public update(): InputState {
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

  public getState(): InputState {
    return this.currentState;
  }

  public hasGamepad(): boolean {
    return this.getGamepad() !== null;
  }

  public hasPointerLock(): boolean {
    return this.isPointerLocked;
  }

  public requestPointerLock(): void {
    this.canvas.requestPointerLock();
  }

  public releasePointerLock(): void {
    document.exitPointerLock();
  }
}
