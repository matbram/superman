/**
 * Superman Flight Game - Main Entry Point
 * Initializes all game systems and runs the main game loop
 */

import { createEngine, startRenderLoop } from './core/engine';
import { createScene } from './core/scene';
import { InputManager } from './input/inputManager';
import { PhysicsManager } from './physics/physics';
import { Player } from './player/Player';
import { City } from './world/City';
import { Atmosphere } from './world/Atmosphere';
import { BuildingDamage } from './world/BuildingDamage';
import { Hud } from './ui/Hud';
import { DebugOverlay } from './ui/DebugOverlay';

/**
 * Main game class
 */
class Game {
  private canvas: HTMLCanvasElement;
  private engine: ReturnType<typeof createEngine>;
  private sceneContext: ReturnType<typeof createScene>;
  private inputManager: InputManager;
  private physicsManager: PhysicsManager;
  private player: Player;
  private city: City;
  private atmosphere: Atmosphere;
  private buildingDamage: BuildingDamage;
  private hud: Hud;
  private debugOverlay: DebugOverlay;

  private isRunning: boolean = false;
  private instructionsElement: HTMLElement;
  private startButton: HTMLElement;

  constructor() {
    // Get canvas element
    this.canvas = document.getElementById('gameCanvas') as HTMLCanvasElement;
    if (!this.canvas) {
      throw new Error('Canvas element not found');
    }

    // Get UI elements
    this.instructionsElement = document.getElementById('instructions')!;
    this.startButton = document.getElementById('startButton')!;

    // Initialize engine
    this.engine = createEngine(this.canvas);

    // Initialize scene
    this.sceneContext = createScene(this.engine);

    // Initialize input
    this.inputManager = new InputManager(this.canvas);

    // Initialize physics
    this.physicsManager = new PhysicsManager(this.sceneContext.scene);

    // Initialize city
    this.city = new City(
      this.sceneContext.scene,
      this.physicsManager,
      this.sceneContext.shadowGenerator
    );

    // Initialize atmosphere (clouds, sun, sky)
    this.atmosphere = new Atmosphere(this.sceneContext.scene);

    // Initialize building damage system
    this.buildingDamage = new BuildingDamage(this.sceneContext.scene);

    // Initialize player
    this.player = new Player(
      this.sceneContext.scene,
      this.physicsManager,
      this.sceneContext.camera,
      this.sceneContext.shadowGenerator
    );

    // Set player spawn position
    this.player.setPosition(this.city.getSpawnPosition());

    // Connect player shockwave to building damage system
    this.player.setOnBuildingDamage((position, radius, force) => {
      const buildings = this.city.getBuildings();
      this.buildingDamage.applyShockwaveDamage(position, radius, force, buildings);
    });

    // Initialize UI
    this.hud = new Hud();
    this.debugOverlay = new DebugOverlay();

    // Set up start button
    this.setupStartButton();

    console.log('Superman Flight Game initialized');
  }

  /**
   * Sets up the start button handler
   */
  private setupStartButton(): void {
    this.startButton.addEventListener('click', () => {
      this.start();
    });

    // Also allow starting with Enter key
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !this.isRunning) {
        this.start();
      }
    });
  }

  /**
   * Starts the game
   */
  private start(): void {
    if (this.isRunning) return;

    this.isRunning = true;

    // Hide instructions
    this.instructionsElement.style.display = 'none';

    // Request pointer lock for mouse control
    this.inputManager.requestPointerLock();

    // Start render loop
    startRenderLoop(this.engine, (deltaTime) => {
      this.update(deltaTime);
    });

    console.log('Game started');
  }

  /**
   * Main update loop
   */
  private update(deltaTime: number): void {
    // Update input
    const input = this.inputManager.update();

    // Toggle debug overlay
    if (input.debugPressed) {
      this.debugOverlay.toggle();
    }

    // Update player
    this.player.update(input, deltaTime);

    // Update city chunks based on player position (procedural generation)
    this.city.updateChunks(this.player.getPosition());

    // Update atmosphere (clouds, sun positioning)
    this.atmosphere.update(this.player.getPosition(), deltaTime);

    // Update building damage (debris physics)
    this.buildingDamage.update(deltaTime);

    // Update HUD
    this.hud.update(
      this.player.getCurrentStateType(),
      this.player.getCurrentSpeed(),
      this.player.isBoost()
    );

    // Update debug overlay
    if (this.debugOverlay.getIsVisible()) {
      const inputInfo = this.getInputDebugInfo(input);
      this.debugOverlay.update(
        this.engine,
        this.player.getCurrentStateType(),
        this.player.getCurrentSpeed(),
        this.player.getPosition(),
        this.player.getVelocity(),
        inputInfo
      );
    }

    // Render scene
    this.sceneContext.scene.render();
  }

  /**
   * Gets input debug information string
   */
  private getInputDebugInfo(input: ReturnType<typeof this.inputManager.update>): string {
    const parts: string[] = [];

    if (Math.abs(input.moveX) > 0.1 || Math.abs(input.moveY) > 0.1) {
      parts.push(`Move: ${input.moveX.toFixed(1)},${input.moveY.toFixed(1)}`);
    }
    if (input.flyTrigger > 0.1) {
      parts.push(`Fly: ${input.flyTrigger.toFixed(1)}`);
    }
    if (input.descendTrigger > 0.1) {
      parts.push(`Descend: ${input.descendTrigger.toFixed(1)}`);
    }
    if (input.boostHeld) {
      parts.push('BOOST');
    }
    if (input.jumpHeld) {
      parts.push('JUMP');
    }

    if (this.inputManager.hasGamepad()) {
      parts.push('[Gamepad]');
    } else if (this.inputManager.hasPointerLock()) {
      parts.push('[KB+Mouse]');
    }

    return parts.length > 0 ? parts.join(' | ') : 'None';
  }
}

// Initialize game when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  try {
    new Game();
  } catch (error) {
    console.error('Failed to initialize game:', error);
    alert('Failed to initialize game. Check console for details.');
  }
});
