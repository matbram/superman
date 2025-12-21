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
import { Birds } from './world/Birds';
import { Traffic } from './world/Traffic';
import { Enemy } from './entities/Enemy';
import { Hud } from './ui/Hud';
import { DebugOverlay } from './ui/DebugOverlay';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';

// Performance logging
const ENABLE_FRAME_PERF_LOGGING = true;
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
  private buildingDamage: BuildingDamage;
  private birds: Birds;
  private traffic: Traffic;
  private enemy: Enemy;
  private hud: Hud;
  private debugOverlay: DebugOverlay;

  // Lock-on system
  private isLockedOn: boolean = false;

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
    buildingDamage: 0,
    birds: 0,
    traffic: 0,
    enemy: 0,
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
    this.buildingDamage = new BuildingDamage(this.sceneContext.scene);

    // Initialize birds
    this.birds = new Birds(this.sceneContext.scene);

    // Initialize traffic system with shadow support
    this.traffic = new Traffic(this.sceneContext.scene, this.sceneContext.shadowGenerator);

    // Initialize enemy AI - spawn in front of player at visible height
    this.enemy = new Enemy(
      this.sceneContext.scene,
      new Vector3(30, 25, 30),  // Spawn nearby and elevated so player can see them
      this.sceneContext.shadowGenerator
    );

    // Connect enemy attacks to building damage with force effects
    this.enemy.setOnAttackBuilding((position, damage, forceDirection) => {
      // Find nearest building to attack position and damage it
      const buildings = this.city.getBuildings();
      let nearestBuilding = null;
      let nearestDist = Infinity;
      for (const building of buildings) {
        const dist = Vector3.Distance(position, building.position);
        if (dist < nearestDist) {
          nearestDist = dist;
          nearestBuilding = building;
        }
      }
      if (nearestBuilding && nearestDist < 100) {
        this.buildingDamage.applyImpactDamage(nearestBuilding, position, damage);

        // Apply force to debris if force direction provided (heat vision blast effect)
        if (forceDirection) {
          this.buildingDamage.applyForceToDebris(position, forceDirection, 50);
        }
      }
    });

    // Connect enemy sonic boom to camera shake
    this.enemy.setOnCameraShake((intensity) => {
      this.player.addCameraShake(intensity);
    });

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

    // Connect player building collision to damage system
    this.player.setOnBuildingCollision((buildingMesh, impactPosition, speed) => {
      this.buildingDamage.applyImpactDamage(buildingMesh, impactPosition, speed);
    });

    // Connect heat vision to damage system with force field effect
    this.player.setOnHeatVisionDamage((building, position, damage, forceDirection) => {
      this.buildingDamage.applyImpactDamage(building, position, damage);

      // Apply devastating force field effect - blows debris across the level
      if (forceDirection) {
        this.buildingDamage.applyForceToDebris(position, forceDirection, 60);
      }
    });

    // Connect building damage camera shake to player camera (distance-based)
    this.buildingDamage.setOnCameraShake((intensity, _position) => {
      // Scale shake based on intensity (0-1), multiply by base shake amount
      // Intensity is already distance-adjusted in BuildingDamage
      this.player.addCameraShake(intensity * 4);  // More dramatic shake
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
    const frameStart = performance.now();
    let t0: number, t1: number;

    // Update input
    const input = this.inputManager.update();

    // Toggle debug overlay
    if (input.debugPressed) {
      this.debugOverlay.toggle();
    }

    // Toggle lock-on to enemy
    if (input.lockOnPressed) {
      if (this.isLockedOn) {
        // Release lock-on
        this.isLockedOn = false;
        this.enemy.setTargeted(false);
      } else {
        // Try to lock on if enemy is alive (no distance limit)
        if (this.enemy.isAlive()) {
          this.isLockedOn = true;
          this.enemy.setTargeted(true);
        }
      }
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

    // Apply supersonic wake damage to nearby buildings (damages buildings on the sides)
    t0 = performance.now();
    const playerSpeed = this.player.getCurrentSpeed();
    const playerPos = this.player.getPosition();
    if (playerSpeed > 80) {
      const buildings = this.city.getBuildings();
      this.buildingDamage.applySupersonicWakeDamage(
        playerPos,
        this.player.getVelocity(),
        playerSpeed,
        buildings
      );
    }
    t1 = performance.now();
    this.perfTimings.wakeDamage += t1 - t0;

    // Update building damage (debris physics, distance-based cleanup)
    t0 = performance.now();
    this.buildingDamage.update(deltaTime, playerPos);
    t1 = performance.now();
    this.perfTimings.buildingDamage += t1 - t0;

    // Update birds
    t0 = performance.now();
    this.birds.update(deltaTime, playerPos);
    t1 = performance.now();
    this.perfTimings.birds += t1 - t0;

    // Update traffic and check vehicle collisions
    t0 = performance.now();
    this.traffic.update(deltaTime, playerPos);
    // Check if player hits vehicles
    if (playerSpeed > 5) {
      this.traffic.checkCollision(playerPos, 1.5, this.player.getVelocity());
    }
    t1 = performance.now();
    this.perfTimings.traffic += t1 - t0;

    // Update enemy AI
    t0 = performance.now();
    const buildings = this.city.getBuildings();
    this.enemy.update(deltaTime, playerPos, buildings);

    // If locked on, check heat vision damage and update camera tracking
    if (this.isLockedOn && this.enemy.isAlive()) {
      // Pass enemy position to camera for tracking
      this.player.setLockOnTarget(this.enemy.getPosition());

      if (input.heatVisionHeld) {
        // Damage enemy with heat vision when locked on
        const heatVisionDamage = 30 * deltaTime;  // DPS when using heat vision
        this.enemy.takeDamage(heatVisionDamage);
      }
    } else if (this.isLockedOn && !this.enemy.isAlive()) {
      // Release lock-on if enemy dies
      this.isLockedOn = false;
      this.enemy.setTargeted(false);
      this.player.setLockOnTarget(null);
    } else {
      // Not locked on - clear target
      this.player.setLockOnTarget(null);
    }
    t1 = performance.now();
    this.perfTimings.enemy += t1 - t0;

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
            buildingDamage: (this.perfTimings.buildingDamage / this.frameCount).toFixed(2) + 'ms',
            birds: (this.perfTimings.birds / this.frameCount).toFixed(2) + 'ms',
            traffic: (this.perfTimings.traffic / this.frameCount).toFixed(2) + 'ms',
            enemy: (this.perfTimings.enemy / this.frameCount).toFixed(2) + 'ms',
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
          buildingDamage: 0,
          birds: 0,
          traffic: 0,
          enemy: 0,
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
    alert('Failed to initialize game. Check console for details.');
  }
});
