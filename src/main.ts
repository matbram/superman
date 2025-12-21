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
import { BuildingDamage, DebrisSettings } from './world/BuildingDamage';
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

  // Pause Menu
  private pauseMenu: HTMLElement;
  private mainMenu: HTMLElement;
  private settingsSubmenu: HTMLElement;
  private debrisCountElement: HTMLElement;
  private menuHintKb: HTMLElement;
  private menuHintPad: HTMLElement;
  private settingsHintKb: HTMLElement;
  private settingsHintPad: HTMLElement;
  private isPaused: boolean = false;
  private inSettingsSubmenu: boolean = false;
  private selectedMenuIndex: number = 0;
  private menuItems: HTMLElement[] = [];

  // Settings navigation
  private selectedSettingIndex: number = 0;
  private settingsControls: {
    input: HTMLInputElement;
    valueDisplay: HTMLElement;
    container: HTMLElement;
    step: number;
    isCheckbox: boolean;
  }[] = [];
  private updateSettingsFromInputs: () => void = () => {};

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

    // Initialize pause menu
    this.pauseMenu = document.getElementById('pauseMenu')!;
    this.mainMenu = document.getElementById('mainMenu')!;
    this.settingsSubmenu = document.getElementById('settingsSubmenu')!;
    this.debrisCountElement = document.getElementById('debrisCount')!;
    this.menuHintKb = document.getElementById('menuHintKb')!;
    this.menuHintPad = document.getElementById('menuHintPad')!;
    this.settingsHintKb = document.getElementById('settingsHintKb')!;
    this.settingsHintPad = document.getElementById('settingsHintPad')!;
    this.menuItems = Array.from(this.mainMenu.querySelectorAll('.menu-item'));
    this.setupPauseMenu();

    // Debug: verify pause menu element exists
    console.log('[Game] Pause menu element:', this.pauseMenu ? 'FOUND' : 'NOT FOUND');
    console.log('[Game] Menu items found:', this.menuItems.length);

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
   * Sets up the pause menu with settings controls
   */
  private setupPauseMenu(): void {
    // Get all input elements
    const maxDebrisInput = document.getElementById('settingMaxDebris') as HTMLInputElement;
    const perBuildingInput = document.getElementById('settingPerBuilding') as HTMLInputElement;
    const minSizeInput = document.getElementById('settingMinSize') as HTMLInputElement;
    const maxSizeInput = document.getElementById('settingMaxSize') as HTMLInputElement;
    const cleanupDistInput = document.getElementById('settingCleanupDist') as HTMLInputElement;
    const settleTimeInput = document.getElementById('settingSettleTime') as HTMLInputElement;
    const explosionsInput = document.getElementById('settingExplosions') as HTMLInputElement;

    // Get value display elements
    const valueMaxDebris = document.getElementById('valueMaxDebris')!;
    const valuePerBuilding = document.getElementById('valuePerBuilding')!;
    const valueMinSize = document.getElementById('valueMinSize')!;
    const valueMaxSize = document.getElementById('valueMaxSize')!;
    const valueCleanupDist = document.getElementById('valueCleanupDist')!;
    const valueSettleTime = document.getElementById('valueSettleTime')!;

    // Build settings controls array for controller navigation
    this.settingsControls = [
      { input: maxDebrisInput, valueDisplay: valueMaxDebris, container: maxDebrisInput.closest('.setting-group')!, step: 5, isCheckbox: false },
      { input: perBuildingInput, valueDisplay: valuePerBuilding, container: perBuildingInput.closest('.setting-group')!, step: 1, isCheckbox: false },
      { input: minSizeInput, valueDisplay: valueMinSize, container: minSizeInput.closest('.setting-group')!, step: 0.5, isCheckbox: false },
      { input: maxSizeInput, valueDisplay: valueMaxSize, container: maxSizeInput.closest('.setting-group')!, step: 0.5, isCheckbox: false },
      { input: cleanupDistInput, valueDisplay: valueCleanupDist, container: cleanupDistInput.closest('.setting-group')!, step: 10, isCheckbox: false },
      { input: settleTimeInput, valueDisplay: valueSettleTime, container: settleTimeInput.closest('.setting-group')!, step: 1, isCheckbox: false },
      { input: explosionsInput, valueDisplay: explosionsInput, container: explosionsInput.closest('.setting-group')!, step: 1, isCheckbox: true },
    ];

    // Helper to update settings
    const updateSettings = () => {
      const newSettings: Partial<DebrisSettings> = {
        maxDebrisPieces: parseInt(maxDebrisInput.value),
        maxDebrisPerBuilding: parseInt(perBuildingInput.value),
        debrisMinSize: parseFloat(minSizeInput.value),
        debrisMaxSize: parseFloat(maxSizeInput.value),
        debrisCleanupDistance: parseInt(cleanupDistInput.value),
        debrisSettleCleanupTime: parseInt(settleTimeInput.value) * 1000,
        explosionsEnabled: explosionsInput.checked,
      };
      this.buildingDamage.updateSettings(newSettings);

      // Update value displays
      valueMaxDebris.textContent = maxDebrisInput.value;
      valuePerBuilding.textContent = perBuildingInput.value;
      valueMinSize.textContent = minSizeInput.value;
      valueMaxSize.textContent = maxSizeInput.value;
      valueCleanupDist.textContent = cleanupDistInput.value;
      valueSettleTime.textContent = settleTimeInput.value;
    };

    // Store updateSettings for controller use
    this.updateSettingsFromInputs = updateSettings;

    // Wire up slider inputs
    maxDebrisInput.addEventListener('input', updateSettings);
    perBuildingInput.addEventListener('input', updateSettings);
    minSizeInput.addEventListener('input', updateSettings);
    maxSizeInput.addEventListener('input', updateSettings);
    cleanupDistInput.addEventListener('input', updateSettings);
    settleTimeInput.addEventListener('input', updateSettings);
    explosionsInput.addEventListener('change', updateSettings);

    // Wire up menu item clicks
    this.menuItems.forEach((item, index) => {
      item.addEventListener('click', () => {
        this.selectedMenuIndex = index;
        this.updateMenuSelection();
        this.executeMenuAction(item.dataset.action || '');
      });
      item.addEventListener('mouseenter', () => {
        this.selectedMenuIndex = index;
        this.updateMenuSelection();
      });
    });

    // Wire up back button
    const backBtn = this.settingsSubmenu.querySelector('.back-btn');
    if (backBtn) {
      backBtn.addEventListener('click', () => this.showMainMenu());
    }
  }

  /**
   * Updates visual selection of menu items
   */
  private updateMenuSelection(): void {
    this.menuItems.forEach((item, index) => {
      item.classList.toggle('selected', index === this.selectedMenuIndex);
    });
  }

  /**
   * Shows the main menu, hides settings
   */
  private showMainMenu(): void {
    this.inSettingsSubmenu = false;
    this.mainMenu.style.display = 'block';
    this.settingsSubmenu.classList.remove('visible');
  }

  /**
   * Shows the settings submenu
   */
  private showSettingsSubmenu(): void {
    this.inSettingsSubmenu = true;
    this.mainMenu.style.display = 'none';
    this.settingsSubmenu.classList.add('visible');
    this.selectedSettingIndex = 0;
    this.updateSettingSelection();
  }

  /**
   * Updates visual selection of settings controls
   */
  private updateSettingSelection(): void {
    this.settingsControls.forEach((control, index) => {
      control.container.classList.toggle('selected', index === this.selectedSettingIndex);
    });
  }

  /**
   * Adjusts the currently selected setting value
   */
  private adjustSelectedSetting(direction: number): void {
    const control = this.settingsControls[this.selectedSettingIndex];
    if (!control) return;

    if (control.isCheckbox) {
      // Toggle checkbox
      control.input.checked = !control.input.checked;
    } else {
      // Adjust slider value
      const currentValue = parseFloat(control.input.value);
      const min = parseFloat(control.input.min);
      const max = parseFloat(control.input.max);
      const newValue = Math.max(min, Math.min(max, currentValue + direction * control.step));
      control.input.value = newValue.toString();
    }

    // Trigger update
    this.updateSettingsFromInputs();
  }

  /**
   * Executes a menu action
   */
  private executeMenuAction(action: string): void {
    switch (action) {
      case 'resume':
        this.togglePause();
        break;
      case 'settings':
        this.showSettingsSubmenu();
        break;
      case 'restart':
        this.restartGame();
        break;
    }
  }

  /**
   * Restarts the game
   */
  private restartGame(): void {
    // Hide pause menu
    this.isPaused = false;
    this.pauseMenu.classList.remove('visible');
    this.showMainMenu();

    // Reset player position
    this.player.setPosition(this.city.getSpawnPosition());

    // Clear all debris and effects
    this.buildingDamage.dispose();
    this.buildingDamage = new BuildingDamage(this.sceneContext.scene);

    // Reconnect callbacks
    this.buildingDamage.setOnCameraShake((intensity, _position) => {
      this.player.addCameraShake(intensity * 4);
    });

    // Reset lock-on
    this.isLockedOn = false;
    this.enemy.setTargeted(false);
    this.player.setLockOnTarget(null);

    // Re-acquire pointer lock
    this.inputManager.requestPointerLock();

    console.log('Game restarted');
  }

  /**
   * Toggles pause state and shows/hides pause menu
   */
  private togglePause(): void {
    this.isPaused = !this.isPaused;
    console.log('[Game] togglePause called, isPaused:', this.isPaused);

    if (this.isPaused) {
      console.log('[Game] Showing pause menu...');
      this.pauseMenu.classList.add('visible');
      console.log('[Game] pauseMenu classList:', this.pauseMenu.classList.toString());
      console.log('[Game] pauseMenu display:', getComputedStyle(this.pauseMenu).display);
      this.showMainMenu();
      this.selectedMenuIndex = 0;
      this.updateMenuSelection();
      // Release pointer lock when paused
      this.inputManager.releasePointerLock();
      // Update hint based on input device
      const hasGamepad = this.inputManager.hasGamepad();
      this.menuHintKb.style.display = hasGamepad ? 'none' : 'inline';
      this.menuHintPad.style.display = hasGamepad ? 'inline' : 'none';
    } else {
      console.log('[Game] Hiding pause menu...');
      this.pauseMenu.classList.remove('visible');
      // Re-acquire pointer lock when unpausing
      this.inputManager.requestPointerLock();
    }
  }

  /**
   * Handles menu navigation input
   */
  private handleMenuInput(input: ReturnType<typeof this.inputManager.update>): void {
    // Update hint based on input device and current menu
    const hasGamepad = this.inputManager.hasGamepad();
    if (this.inSettingsSubmenu) {
      this.menuHintKb.style.display = 'none';
      this.menuHintPad.style.display = 'none';
      this.settingsHintKb.style.display = hasGamepad ? 'none' : 'inline';
      this.settingsHintPad.style.display = hasGamepad ? 'inline' : 'none';
    } else {
      this.menuHintKb.style.display = hasGamepad ? 'none' : 'inline';
      this.menuHintPad.style.display = hasGamepad ? 'inline' : 'none';
      this.settingsHintKb.style.display = 'none';
      this.settingsHintPad.style.display = 'none';
    }

    if (this.inSettingsSubmenu) {
      // In settings submenu - navigate and adjust settings
      if (input.menuUp) {
        this.selectedSettingIndex = (this.selectedSettingIndex - 1 + this.settingsControls.length) % this.settingsControls.length;
        this.updateSettingSelection();
      }
      if (input.menuDown) {
        this.selectedSettingIndex = (this.selectedSettingIndex + 1) % this.settingsControls.length;
        this.updateSettingSelection();
      }
      // D-pad left/right adjusts the selected setting
      if (input.menuLeft) {
        this.adjustSelectedSetting(-1);
      }
      if (input.menuRight) {
        this.adjustSelectedSetting(1);
      }
      // A button toggles checkbox settings
      if (input.menuSelect) {
        const control = this.settingsControls[this.selectedSettingIndex];
        if (control?.isCheckbox) {
          control.input.checked = !control.input.checked;
          this.updateSettingsFromInputs();
        }
      }
      // B/Backspace goes back to main menu
      if (input.menuBack || input.pausePressed) {
        this.showMainMenu();
      }
    } else {
      // In main menu - navigate and select
      if (input.menuUp) {
        this.selectedMenuIndex = (this.selectedMenuIndex - 1 + this.menuItems.length) % this.menuItems.length;
        this.updateMenuSelection();
      }
      if (input.menuDown) {
        this.selectedMenuIndex = (this.selectedMenuIndex + 1) % this.menuItems.length;
        this.updateMenuSelection();
      }
      if (input.menuSelect) {
        const action = this.menuItems[this.selectedMenuIndex].dataset.action || '';
        this.executeMenuAction(action);
      }
      // ESC while in main menu closes pause
      if (input.pausePressed) {
        this.togglePause();
      }
    }
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

    // Update input (always, even when paused)
    const input = this.inputManager.update();

    // Toggle debug overlay
    if (input.debugPressed) {
      this.debugOverlay.toggle();
    }

    // If NOT paused and pause is pressed, enter pause mode
    if (input.pausePressed && !this.isPaused) {
      console.log('[Game] Pause triggered!');
      this.togglePause();
      // Don't process menu input on the same frame we entered pause
      // (pausePressed is still true and would immediately close the menu)
      this.sceneContext.scene.render();
      return;
    }

    // If paused, handle menu input and render only
    if (this.isPaused) {
      // Update debris count display
      this.debrisCountElement.textContent = this.buildingDamage.getDebrisCount().toString();
      // Handle menu navigation (including pause button to close or go back)
      this.handleMenuInput(input);
      // Still render the scene (frozen)
      this.sceneContext.scene.render();
      return;
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
