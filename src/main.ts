/**
 * Superman Flight Game - Main Entry Point
 * Initializes all game systems and runs the main game loop
 */

import { createEngine, startRenderLoop } from './core/engine';
import { createScene } from './core/scene';
import { InputManager } from './input/inputManager';
import { PhysicsManager } from './physics/physics';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { Player } from './player/Player';
import { City } from './world/City';
import { Atmosphere } from './world/Atmosphere';
import { VoxelWorld } from './world/VoxelWorld';
import { AlienShip } from './world/AlienShip';
import { Birds } from './world/Birds';
import { Hud } from './ui/Hud';
import { DebugOverlay } from './ui/DebugOverlay';
import { Diag } from './core/DiagnosticLog';

// Performance logging
const ENABLE_FRAME_PERF_LOGGING = false;
const FRAME_PERF_LOG_INTERVAL = 2000;  // Log every 2 seconds

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
  private voxelWorld: VoxelWorld;
  private alienShip: AlienShip;
  private birds: Birds;
  private hud: Hud;
  private debugOverlay: DebugOverlay;

  private isRunning: boolean = false;
  private instructionsElement: HTMLElement;
  private startButton: HTMLElement;

  // Performance tracking
  private lastPerfLogTime: number = 0;
  private frameCount: number = 0;
  private totalFrameTime: number = 0;
  private maxFrameTime: number = 0;
  private perfTimings = {
    player: 0,
    city: 0,
    atmosphere: 0,
    wakeDamage: 0,
    voxelWorld: 0,
    alienShip: 0,
    birds: 0,
    render: 0,
  };

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
    this.voxelWorld = new VoxelWorld(this.sceneContext.scene, this.physicsManager);

    // Give physics direct access to VoxelWorld for grid-based collision
    this.physicsManager.voxelWorld = this.voxelWorld;

    // Clean up voxelized buildings when chunks unload
    this.city.onChunkUnload = (chunkKey: string) => {
      this.voxelWorld.cleanupChunk(chunkKey);
    };

    // Initialize alien ship (World Engine style gravity beam)
    this.alienShip = new AlienShip(this.sceneContext.scene);

    // Connect alien ship gravity zone to building damage system
    this.voxelWorld.setGravityZone(
      this.alienShip.getGravityZone(),
      (pos) => this.alienShip.getGravityAtPosition(pos)
    );

    // Alien beam: only damages already-voxelized buildings (perf safety)
    this.alienShip.setOnBuildingDamage((position, radius, damage) => {
      const buildings = this.city.getBuildings();
      for (const building of buildings) {
        const dx = building.position.x - position.x;
        const dz = building.position.z - position.z;
        if (dx * dx + dz * dz < radius * radius && this.voxelWorld.isVoxelized(building)) {
          this.voxelWorld.applyDamage(building, building.position, damage);
        }
      }
    });

    // Initialize birds
    this.birds = new Birds(this.sceneContext.scene);

    // Initialize player
    this.player = new Player(
      this.sceneContext.scene,
      this.physicsManager,
      this.sceneContext.camera,
      this.sceneContext.shadowGenerator
    );

    // Set player spawn position
    this.player.setPosition(this.city.getSpawnPosition());

    // Shockwave: damage nearby buildings
    this.player.setOnBuildingDamage((position, radius, force) => {
      const buildings = this.city.getBuildings();
      for (const building of buildings) {
        const dx = building.position.x - position.x;
        const dz = building.position.z - position.z;
        const dist = Math.sqrt(dx * dx + dz * dz);
        if (dist < radius) {
          this.voxelWorld.applyDamage(building, position, force * (1 - dist / radius) * 30);
        }
      }
    });

    // Player collision (backup for grazing hits physics might miss)
    this.player.setOnBuildingCollision((buildingMesh, impactPosition, speed) => {
      this.voxelWorld.applyDamage(buildingMesh, impactPosition, speed);
    });

    // Heat vision
    this.player.setOnHeatVisionDamage((building, position, damage) => {
      this.voxelWorld.applyDamage(building as Mesh, position, damage);
    });

    // Camera shake from building destruction (collapses, debris impacts)
    this.voxelWorld.onCameraShake = (intensity: number) => {
      this.player.getCameraController().addShake(intensity);
    };

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
    const frameStart = performance.now();
    let t0: number, t1: number;

    // Update input
    const input = this.inputManager.update();

    // Toggle debug overlay
    if (input.debugPressed) {
      this.debugOverlay.toggle();
    }

    // Update player
    t0 = performance.now();
    this.player.update(input, deltaTime);
    t1 = performance.now();
    this.perfTimings.player += t1 - t0;

    // Update city chunks based on player position (procedural generation)
    t0 = performance.now();
    this.city.updateChunks(this.player.getPosition());
    t1 = performance.now();
    this.perfTimings.city += t1 - t0;

    // Update atmosphere (clouds, sun positioning, cloud dispersion)
    t0 = performance.now();
    this.atmosphere.update(
      this.player.getPosition(),
      deltaTime,
      this.player.getVelocity(),
      this.player.getCurrentSpeed()
    );
    t1 = performance.now();
    this.perfTimings.atmosphere += t1 - t0;

    // Supersonic wake: damage already-voxelized buildings near flight path
    t0 = performance.now();
    const playerSpeed = this.player.getCurrentSpeed();
    const playerPos = this.player.getPosition();
    if (playerSpeed > 80) {
      const wakeRadius = 40 + (playerSpeed - 80) * 0.3;
      const wakeRadiusSq = wakeRadius * wakeRadius;
      const buildings = this.city.getBuildings();
      for (const building of buildings) {
        const dx = building.position.x - playerPos.x;
        const dz = building.position.z - playerPos.z;
        const distSq = dx * dx + dz * dz;
        if (distSq < wakeRadiusSq && distSq > 64 && this.voxelWorld.isVoxelized(building)) {
          this.voxelWorld.applyDamage(building, building.position, playerSpeed * 0.3);
        }
      }
    }
    t1 = performance.now();
    this.perfTimings.wakeDamage += t1 - t0;

    // Update building damage (debris physics, distance-based cleanup)
    t0 = performance.now();
    this.voxelWorld.update(deltaTime, playerPos);
    t1 = performance.now();
    this.perfTimings.voxelWorld += t1 - t0;

    // Update alien ship (gravity beam, oscillating effects)
    t0 = performance.now();
    this.alienShip.update(deltaTime);
    t1 = performance.now();
    this.perfTimings.alienShip += t1 - t0;

    // Update birds
    t0 = performance.now();
    this.birds.update(deltaTime, playerPos);
    t1 = performance.now();
    this.perfTimings.birds += t1 - t0;

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

    // Diagnostics
    Diag.track('Frame', 'playerSpeed', this.player.getCurrentSpeed());
    Diag.track('Frame', 'meshCount', this.sceneContext.scene.meshes.length);
    Diag.update();

    // Render scene
    t0 = performance.now();
    this.sceneContext.scene.render();
    t1 = performance.now();
    this.perfTimings.render += t1 - t0;

    // Performance logging
    const frameEnd = performance.now();
    const frameTime = frameEnd - frameStart;

    if (ENABLE_FRAME_PERF_LOGGING) {
      this.frameCount++;
      this.totalFrameTime += frameTime;
      this.maxFrameTime = Math.max(this.maxFrameTime, frameTime);

      if (frameEnd - this.lastPerfLogTime > FRAME_PERF_LOG_INTERVAL) {
        const avgFrame = this.totalFrameTime / this.frameCount;
        const avgFps = 1000 / avgFrame;
        console.log('[Frame Perf]', {
          avgFrame: avgFrame.toFixed(2) + 'ms',
          maxFrame: this.maxFrameTime.toFixed(2) + 'ms',
          avgFps: avgFps.toFixed(1),
          breakdown: {
            player: (this.perfTimings.player / this.frameCount).toFixed(2) + 'ms',
            city: (this.perfTimings.city / this.frameCount).toFixed(2) + 'ms',
            atmosphere: (this.perfTimings.atmosphere / this.frameCount).toFixed(2) + 'ms',
            wakeDamage: (this.perfTimings.wakeDamage / this.frameCount).toFixed(2) + 'ms',
            voxelWorld: (this.perfTimings.voxelWorld / this.frameCount).toFixed(2) + 'ms',
            alienShip: (this.perfTimings.alienShip / this.frameCount).toFixed(2) + 'ms',
            birds: (this.perfTimings.birds / this.frameCount).toFixed(2) + 'ms',
            render: (this.perfTimings.render / this.frameCount).toFixed(2) + 'ms',
          }
        });

        // Reset
        this.lastPerfLogTime = frameEnd;
        this.frameCount = 0;
        this.totalFrameTime = 0;
        this.maxFrameTime = 0;
        this.perfTimings = {
          player: 0,
          city: 0,
          atmosphere: 0,
          wakeDamage: 0,
          voxelWorld: 0,
          alienShip: 0,
          birds: 0,
          render: 0,
        };
      }
    }
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
    const message =
      error instanceof Error ? error.message : 'Unknown error occurred.';

    // Show error in the instructions overlay instead of a generic alert
    const instructions = document.getElementById('instructions');
    if (instructions) {
      instructions.innerHTML =
        '<h1 style="color:#ff4444">Failed to Start Game</h1>' +
        '<p style="white-space:pre-line;margin:20px 0;text-align:left">' +
        message +
        '</p>';
    } else {
      alert(message);
    }
  }
});
