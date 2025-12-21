/**
 * AI Enemy - A villain flying around destroying the city
 * Has similar abilities to the player (flight, heat vision)
 * Can be damaged and killed by player's heat vision
 */

import { Scene } from '@babylonjs/core/scene';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { ParticleSystem } from '@babylonjs/core/Particles/particleSystem';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import { ShadowGenerator } from '@babylonjs/core/Lights/Shadows/shadowGenerator';

// Enemy constants
const ENEMY_MAX_HEALTH = 500;
const ENEMY_MIN_SPEED = 30;       // Minimum cruising speed
const ENEMY_MAX_SPEED = 200;      // Supersonic max speed
const ENEMY_ACCELERATION = 80;    // How fast to accelerate
const ENEMY_ATTACK_RANGE = 100;   // Wider attack range
const ENEMY_ATTACK_COOLDOWN = 1500;  // Attack more frequently
const ENEMY_PATROL_RADIUS = 150;  // Larger patrol area
const ENEMY_HEIGHT_MIN = 25;      // Above buildings
const ENEMY_HEIGHT_MAX = 80;
const ENEMY_TURN_RATE = 2.5;      // How fast the enemy can turn
const ENEMY_SHOCKWAVE_THRESHOLD = 120; // Speed for shockwave effect

// AI behavior states
enum EnemyState {
  Patrol = 0,
  Attack = 1,
  Flee = 2,
  Dead = 3
}

/**
 * AI Enemy class
 */
export class Enemy {
  private scene: Scene;
  private shadowGenerator: ShadowGenerator | null = null;
  private root: TransformNode;
  private bodyMeshes: Mesh[] = [];
  private position: Vector3 = new Vector3(0, 60, 100);
  private velocity: Vector3 = Vector3.Zero();
  private targetPosition: Vector3 = Vector3.Zero();
  private lastKnownPlayerPosition: Vector3 = Vector3.Zero();

  // Stats
  private health: number = ENEMY_MAX_HEALTH;
  private state: EnemyState = EnemyState.Patrol;
  private lastAttackTime: number = 0;

  // Dynamic flight
  private currentSpeed: number = 0;
  private targetSpeed: number = ENEMY_MIN_SPEED;
  private yaw: number = 0;
  private pitch: number = 0;
  private roll: number = 0;
  private wasAboveShockwaveThreshold: boolean = false;

  // Visual
  private heatVisionBeam: Mesh | null = null;
  private thrusterParticles: ParticleSystem | null = null;
  private shockwaveRings: Mesh[] = [];
  private speedParticles: ParticleSystem | null = null;

  // Callbacks
  private onAttackBuilding: ((position: Vector3, damage: number, forceDirection?: Vector3) => void) | null = null;
  private onDeath: (() => void) | null = null;
  private onCameraShake: ((intensity: number) => void) | null = null;

  // Target indicator
  private targetIndicator: Mesh | null = null;
  private isTargeted: boolean = false;

  constructor(scene: Scene, spawnPosition?: Vector3, shadowGenerator?: ShadowGenerator) {
    this.scene = scene;
    this.shadowGenerator = shadowGenerator || null;
    this.root = new TransformNode('enemy', scene);

    if (spawnPosition) {
      this.position = spawnPosition.clone();
    }

    this.root.position = this.position;

    this.createVillainModel();
    this.createThrusterEffect();
    this.createSpeedParticles();
    this.createHeatVisionBeam();
    this.createTargetIndicator();
    this.setNewPatrolTarget();
  }

  /**
   * Creates the villain character model (dark version of player)
   */
  private createVillainModel(): void {
    // Materials - dark/evil color scheme
    const suitMat = new StandardMaterial('villainSuit', this.scene);
    suitMat.diffuseColor = new Color3(0.15, 0.15, 0.15);  // Dark gray/black suit
    suitMat.specularColor = new Color3(0.3, 0.3, 0.3);
    suitMat.freeze();

    const skinMat = new StandardMaterial('villainSkin', this.scene);
    skinMat.diffuseColor = new Color3(0.7, 0.6, 0.5);
    skinMat.freeze();

    const capeMat = new StandardMaterial('villainCape', this.scene);
    capeMat.diffuseColor = new Color3(0.4, 0.1, 0.5);  // Purple cape
    capeMat.freeze();

    const eyeMat = new StandardMaterial('villainEyes', this.scene);
    eyeMat.diffuseColor = new Color3(1, 0.2, 0.2);  // Red glowing eyes
    eyeMat.emissiveColor = new Color3(0.8, 0.1, 0.1);
    eyeMat.freeze();

    const V = 2.0;  // Voxel size - much larger to be visible

    // Body/torso
    const torso = MeshBuilder.CreateBox('torso', {
      width: V * 4, height: V * 5, depth: V * 2
    }, this.scene);
    torso.position.y = V * 2;
    torso.material = suitMat;
    torso.parent = this.root;
    this.bodyMeshes.push(torso);

    // Head
    const head = MeshBuilder.CreateBox('head', {
      width: V * 2.5, height: V * 2.5, depth: V * 2.5
    }, this.scene);
    head.position.y = V * 5.5;
    head.material = skinMat;
    head.parent = this.root;
    this.bodyMeshes.push(head);

    // Glowing eyes
    const leftEye = MeshBuilder.CreateBox('leftEye', {
      width: V * 0.4, height: V * 0.3, depth: V * 0.2
    }, this.scene);
    leftEye.position = new Vector3(-V * 0.5, V * 5.7, V * 1.2);
    leftEye.material = eyeMat;
    leftEye.parent = this.root;
    this.bodyMeshes.push(leftEye);

    const rightEye = MeshBuilder.CreateBox('rightEye', {
      width: V * 0.4, height: V * 0.3, depth: V * 0.2
    }, this.scene);
    rightEye.position = new Vector3(V * 0.5, V * 5.7, V * 1.2);
    rightEye.material = eyeMat;
    rightEye.parent = this.root;
    this.bodyMeshes.push(rightEye);

    // Arms
    const armMat = suitMat;
    const leftArm = MeshBuilder.CreateBox('leftArm', {
      width: V * 1.2, height: V * 4, depth: V * 1.2
    }, this.scene);
    leftArm.position = new Vector3(-V * 2.8, V * 2, 0);
    leftArm.material = armMat;
    leftArm.parent = this.root;
    this.bodyMeshes.push(leftArm);

    const rightArm = MeshBuilder.CreateBox('rightArm', {
      width: V * 1.2, height: V * 4, depth: V * 1.2
    }, this.scene);
    rightArm.position = new Vector3(V * 2.8, V * 2, 0);
    rightArm.material = armMat;
    rightArm.parent = this.root;
    this.bodyMeshes.push(rightArm);

    // Legs
    const leftLeg = MeshBuilder.CreateBox('leftLeg', {
      width: V * 1.4, height: V * 4, depth: V * 1.4
    }, this.scene);
    leftLeg.position = new Vector3(-V * 1, -V * 2.5, 0);
    leftLeg.material = suitMat;
    leftLeg.parent = this.root;
    this.bodyMeshes.push(leftLeg);

    const rightLeg = MeshBuilder.CreateBox('rightLeg', {
      width: V * 1.4, height: V * 4, depth: V * 1.4
    }, this.scene);
    rightLeg.position = new Vector3(V * 1, -V * 2.5, 0);
    rightLeg.material = suitMat;
    rightLeg.parent = this.root;
    this.bodyMeshes.push(rightLeg);

    // Simple cape (static for now)
    const cape = MeshBuilder.CreateBox('cape', {
      width: V * 4, height: V * 5, depth: V * 0.3
    }, this.scene);
    cape.position = new Vector3(0, V * 1.5, -V * 1.3);
    cape.material = capeMat;
    cape.parent = this.root;
    this.bodyMeshes.push(cape);

    // Add all body meshes to shadow system
    if (this.shadowGenerator) {
      for (const mesh of this.bodyMeshes) {
        this.shadowGenerator.addShadowCaster(mesh);
        mesh.receiveShadows = true;
      }
    }
  }

  /**
   * Creates thruster particle effect for flight
   */
  private createThrusterEffect(): void {
    this.thrusterParticles = new ParticleSystem('enemyThrusters', 30, this.scene);

    // Create simple texture
    this.thrusterParticles.particleTexture = new Texture(
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAAA0SURBVChTY/z//z8DEwMBwESAAOggFgZCYNQEXABZE4omnCbgNQGvCTiB0AS8JuA0gYEBAGqkBQm7+hkOAAAAAElFTkSuQmCC',
      this.scene
    );

    // Use first body mesh (torso) as emitter - it follows the root
    this.thrusterParticles.emitter = this.bodyMeshes[0] || this.position;
    this.thrusterParticles.minEmitBox = new Vector3(-2, -5, -2);
    this.thrusterParticles.maxEmitBox = new Vector3(2, -5, 2);

    this.thrusterParticles.color1 = new Color3(0.6, 0.1, 0.8).toColor4(0.8);  // Purple
    this.thrusterParticles.color2 = new Color3(0.8, 0.2, 1).toColor4(0.6);
    this.thrusterParticles.colorDead = new Color3(0.3, 0, 0.4).toColor4(0);

    this.thrusterParticles.minSize = 1.5;
    this.thrusterParticles.maxSize = 3;
    this.thrusterParticles.minLifeTime = 0.3;
    this.thrusterParticles.maxLifeTime = 0.6;

    this.thrusterParticles.emitRate = 60;
    this.thrusterParticles.blendMode = ParticleSystem.BLENDMODE_ADD;

    this.thrusterParticles.direction1 = new Vector3(-1, -1, -1);
    this.thrusterParticles.direction2 = new Vector3(1, -1, 1);
    this.thrusterParticles.minEmitPower = 8;
    this.thrusterParticles.maxEmitPower = 15;

    this.thrusterParticles.start();
  }

  /**
   * Creates speed streak particle effect for supersonic flight
   */
  private createSpeedParticles(): void {
    this.speedParticles = new ParticleSystem('enemySpeedParticles', 80, this.scene);

    this.speedParticles.particleTexture = new Texture(
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAAA0SURBVChTY/z//z8DEwMBwESAAOggFgZCYNQEXABZE4omnCbgNQGvCTiB0AS8JuA0gYEBAGqkBQm7+hkOAAAAAElFTkSuQmCC',
      this.scene
    );

    this.speedParticles.emitter = this.bodyMeshes[0] || this.position;
    this.speedParticles.minEmitBox = new Vector3(-1, -1, -1);
    this.speedParticles.maxEmitBox = new Vector3(1, 1, 1);

    // Purple/dark speed trails
    this.speedParticles.color1 = new Color3(0.6, 0.2, 0.8).toColor4(0.6);
    this.speedParticles.color2 = new Color3(0.8, 0.3, 1).toColor4(0.4);
    this.speedParticles.colorDead = new Color3(0.3, 0.1, 0.4).toColor4(0);

    this.speedParticles.minSize = 0.1;
    this.speedParticles.maxSize = 0.3;
    this.speedParticles.minLifeTime = 0.1;
    this.speedParticles.maxLifeTime = 0.25;

    this.speedParticles.emitRate = 0; // Controlled by speed
    this.speedParticles.blendMode = ParticleSystem.BLENDMODE_ADD;

    this.speedParticles.direction1 = new Vector3(-1, -0.5, -1);
    this.speedParticles.direction2 = new Vector3(1, 0.5, -1);
    this.speedParticles.minEmitPower = 8;
    this.speedParticles.maxEmitPower = 15;

    this.speedParticles.start();
  }

  /**
   * Creates a shockwave ring mesh for sonic boom effect
   */
  private createShockwaveRing(): Mesh {
    const ring = MeshBuilder.CreateTorus('enemyShockwave', {
      diameter: 10,
      thickness: 0.6,
      tessellation: 32,
    }, this.scene);

    const material = new StandardMaterial('enemyShockwaveMat', this.scene);
    material.diffuseColor = new Color3(0.7, 0.3, 1);
    material.emissiveColor = new Color3(0.5, 0.2, 0.8);
    material.alpha = 0.8;
    material.backFaceCulling = false;

    ring.material = material;
    ring.isPickable = false;
    ring.visibility = 0;

    return ring;
  }

  /**
   * Spawns supersonic shockwave effect
   */
  private spawnShockwave(): void {
    // Create multiple rings for dramatic effect
    for (let i = 0; i < 3; i++) {
      const ring = this.createShockwaveRing();
      ring.position.copyFrom(this.position);
      ring.rotation.x = Math.PI / 2;
      ring.rotation.y = this.yaw;
      ring.scaling = new Vector3(1 + i * 0.5, 1 + i * 0.5, 1 + i * 0.5);
      ring.visibility = 1 - i * 0.15;
      this.shockwaveRings.push(ring);
    }

    // HARD camera shake when sonic boom happens
    if (this.onCameraShake) {
      const shakeIntensity = 4 + (this.currentSpeed / ENEMY_MAX_SPEED) * 3;
      this.onCameraShake(shakeIntensity);
    }
  }

  /**
   * Updates shockwave rings (expand and fade)
   */
  private updateShockwaves(deltaTime: number): void {
    for (let i = this.shockwaveRings.length - 1; i >= 0; i--) {
      const ring = this.shockwaveRings[i];

      // Expand
      ring.scaling.x += 40 * deltaTime;
      ring.scaling.y += 40 * deltaTime;
      ring.scaling.z += 40 * deltaTime;

      // Fade
      ring.visibility -= 2 * deltaTime;

      if (ring.visibility <= 0) {
        ring.dispose();
        this.shockwaveRings.splice(i, 1);
      }
    }
  }

  // Secondary heat vision elements for massive effect
  private heatVisionBeamLeft: Mesh | null = null;
  private heatVisionBeamRight: Mesh | null = null;
  private heatVisionGlow: Mesh | null = null;
  private heatVisionParticles: ParticleSystem | null = null;

  /**
   * Creates the heat vision beam for attacking - MASSIVE DESTRUCTIVE BEAMS
   */
  private createHeatVisionBeam(): void {
    // Main center beam - MASSIVE
    this.heatVisionBeam = MeshBuilder.CreateCylinder('enemyHeatBeam', {
      diameterTop: 2,
      diameterBottom: 8,
      height: 100,
      tessellation: 16
    }, this.scene);

    const beamMat = new StandardMaterial('enemyBeamMat', this.scene);
    beamMat.diffuseColor = new Color3(1, 0.2, 0.2);  // Red-hot beam
    beamMat.emissiveColor = new Color3(1, 0.3, 0.1);
    beamMat.alpha = 0;
    beamMat.backFaceCulling = false;

    this.heatVisionBeam.material = beamMat;
    this.heatVisionBeam.parent = this.root;
    this.heatVisionBeam.position.y = 2.5;
    this.heatVisionBeam.rotation.x = Math.PI / 2;
    this.heatVisionBeam.position.z = 50;
    this.heatVisionBeam.isPickable = false;

    // Left eye beam
    this.heatVisionBeamLeft = MeshBuilder.CreateCylinder('enemyHeatBeamLeft', {
      diameterTop: 1.5,
      diameterBottom: 5,
      height: 100,
      tessellation: 12
    }, this.scene);

    const beamMatLeft = new StandardMaterial('enemyBeamMatLeft', this.scene);
    beamMatLeft.diffuseColor = new Color3(1, 0.5, 0);  // Orange
    beamMatLeft.emissiveColor = new Color3(1, 0.4, 0.1);
    beamMatLeft.alpha = 0;
    beamMatLeft.backFaceCulling = false;

    this.heatVisionBeamLeft.material = beamMatLeft;
    this.heatVisionBeamLeft.parent = this.root;
    this.heatVisionBeamLeft.position = new Vector3(-2, 11, 50);
    this.heatVisionBeamLeft.rotation.x = Math.PI / 2;
    this.heatVisionBeamLeft.isPickable = false;

    // Right eye beam
    this.heatVisionBeamRight = MeshBuilder.CreateCylinder('enemyHeatBeamRight', {
      diameterTop: 1.5,
      diameterBottom: 5,
      height: 100,
      tessellation: 12
    }, this.scene);

    const beamMatRight = new StandardMaterial('enemyBeamMatRight', this.scene);
    beamMatRight.diffuseColor = new Color3(1, 0.5, 0);
    beamMatRight.emissiveColor = new Color3(1, 0.4, 0.1);
    beamMatRight.alpha = 0;
    beamMatRight.backFaceCulling = false;

    this.heatVisionBeamRight.material = beamMatRight;
    this.heatVisionBeamRight.parent = this.root;
    this.heatVisionBeamRight.position = new Vector3(2, 11, 50);
    this.heatVisionBeamRight.rotation.x = Math.PI / 2;
    this.heatVisionBeamRight.isPickable = false;

    // Glow sphere at impact point
    this.heatVisionGlow = MeshBuilder.CreateSphere('enemyHeatGlow', {
      diameter: 15,
      segments: 8
    }, this.scene);

    const glowMat = new StandardMaterial('enemyGlowMat', this.scene);
    glowMat.diffuseColor = new Color3(1, 0.6, 0);
    glowMat.emissiveColor = new Color3(1, 0.5, 0.2);
    glowMat.alpha = 0;
    glowMat.backFaceCulling = false;

    this.heatVisionGlow.material = glowMat;
    this.heatVisionGlow.isPickable = false;

    // Heat vision particles at impact
    this.heatVisionParticles = new ParticleSystem('enemyHeatParticles', 200, this.scene);

    this.heatVisionParticles.particleTexture = new Texture(
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAAA0SURBVChTY/z//z8DEwMBwESAAOggFgZCYNQEXABZE4omnCbgNQGvCTiB0AS8JuA0gYEBAGqkBQm7+hkOAAAAAElFTkSuQmCC',
      this.scene
    );

    this.heatVisionParticles.emitter = this.heatVisionGlow;
    this.heatVisionParticles.minEmitBox = new Vector3(-3, -3, -3);
    this.heatVisionParticles.maxEmitBox = new Vector3(3, 3, 3);

    this.heatVisionParticles.color1 = new Color3(1, 0.6, 0).toColor4(1);
    this.heatVisionParticles.color2 = new Color3(1, 0.3, 0).toColor4(0.8);
    this.heatVisionParticles.colorDead = new Color3(0.5, 0.1, 0).toColor4(0);

    this.heatVisionParticles.minSize = 1;
    this.heatVisionParticles.maxSize = 3;
    this.heatVisionParticles.minLifeTime = 0.3;
    this.heatVisionParticles.maxLifeTime = 0.8;

    this.heatVisionParticles.emitRate = 0;
    this.heatVisionParticles.blendMode = ParticleSystem.BLENDMODE_ADD;

    this.heatVisionParticles.direction1 = new Vector3(-2, 2, -2);
    this.heatVisionParticles.direction2 = new Vector3(2, 5, 2);
    this.heatVisionParticles.minEmitPower = 10;
    this.heatVisionParticles.maxEmitPower = 25;

    this.heatVisionParticles.start();
  }

  /**
   * Creates target indicator for lock-on system
   */
  private createTargetIndicator(): void {
    // Create diamond-shaped target indicator - large and visible
    this.targetIndicator = MeshBuilder.CreateBox('targetIndicator', {
      width: 15, height: 15, depth: 0.5
    }, this.scene);

    const indicatorMat = new StandardMaterial('targetMat', this.scene);
    indicatorMat.diffuseColor = new Color3(1, 0.3, 0.3);
    indicatorMat.emissiveColor = new Color3(1, 0.2, 0.2);
    indicatorMat.alpha = 0;
    indicatorMat.backFaceCulling = false;

    this.targetIndicator.material = indicatorMat;
    this.targetIndicator.rotation.z = Math.PI / 4;  // Diamond shape
    this.targetIndicator.parent = this.root;
    this.targetIndicator.position.y = 20;  // Above the larger character
    this.targetIndicator.isPickable = false;
  }

  /**
   * Sets a new random patrol target AROUND THE PLAYER (not origin)
   */
  private setNewPatrolTarget(): void {
    const angle = Math.random() * Math.PI * 2;
    const radius = ENEMY_PATROL_RADIUS * (0.3 + Math.random() * 0.7);

    // Patrol around player position, not origin
    this.targetPosition = new Vector3(
      this.lastKnownPlayerPosition.x + Math.cos(angle) * radius,
      ENEMY_HEIGHT_MIN + Math.random() * (ENEMY_HEIGHT_MAX - ENEMY_HEIGHT_MIN),
      this.lastKnownPlayerPosition.z + Math.sin(angle) * radius
    );
  }

  /**
   * Sets callback for when enemy attacks a building
   */
  public setOnAttackBuilding(callback: (position: Vector3, damage: number, forceDirection?: Vector3) => void): void {
    this.onAttackBuilding = callback;
  }

  /**
   * Sets callback for camera shake effects
   */
  public setOnCameraShake(callback: (intensity: number) => void): void {
    this.onCameraShake = callback;
  }

  /**
   * Sets callback for when enemy dies
   */
  public setOnDeath(callback: () => void): void {
    this.onDeath = callback;
  }

  /**
   * Applies damage to the enemy (from player's heat vision)
   */
  public takeDamage(damage: number): void {
    if (this.state === EnemyState.Dead) return;

    this.health -= damage;

    // Flash effect when hit
    for (const mesh of this.bodyMeshes) {
      const mat = mesh.material as StandardMaterial;
      if (mat) {
        const originalEmissive = mat.emissiveColor.clone();
        mat.emissiveColor = new Color3(1, 1, 1);
        setTimeout(() => {
          if (mat) mat.emissiveColor = originalEmissive;
        }, 100);
      }
    }

    if (this.health <= 0) {
      this.die();
    }
  }

  /**
   * Kills the enemy
   */
  private die(): void {
    this.state = EnemyState.Dead;

    // Stop particles
    if (this.thrusterParticles) {
      this.thrusterParticles.stop();
    }

    // Fall to ground
    this.velocity = new Vector3(0, -30, 0);

    if (this.onDeath) {
      this.onDeath();
    }
  }

  /**
   * Updates the enemy each frame
   */
  public update(deltaTime: number, playerPosition: Vector3, buildings: Mesh[]): void {
    // Always track player position for patrol behavior
    this.lastKnownPlayerPosition = playerPosition.clone();

    if (this.state === EnemyState.Dead) {
      // Fall when dead
      this.velocity.y += -20 * deltaTime;
      this.position.addInPlace(this.velocity.scale(deltaTime));
      if (this.position.y < 0) {
        this.position.y = 0;
        this.velocity = Vector3.Zero();
      }
      this.root.position = this.position;
      return;
    }

    const now = performance.now();

    // Update AI behavior - sets target position and speed
    this.updateAI(deltaTime, playerPosition, buildings, now);

    // Update dynamic flight - proper acceleration and turning
    this.updateDynamicFlight(deltaTime);

    // Update visual effects
    this.updateFlightEffects(deltaTime);

    // Update shockwaves
    this.updateShockwaves(deltaTime);

    // Update position from velocity
    this.position.addInPlace(this.velocity.scale(deltaTime));
    this.root.position = this.position;

    // Update character rotation with banking
    this.updateCharacterRotation(deltaTime);

    // Update target indicator
    this.updateTargetIndicator(deltaTime);
  }

  /**
   * Updates dynamic flight with acceleration and turning
   */
  private updateDynamicFlight(deltaTime: number): void {
    // Get direction to target
    const toTarget = this.targetPosition.subtract(this.position);
    const distToTarget = toTarget.length();

    if (distToTarget > 5) {
      // Calculate target yaw (horizontal direction)
      const targetYaw = Math.atan2(toTarget.x, toTarget.z);

      // Smoothly turn towards target
      let yawDiff = targetYaw - this.yaw;
      // Normalize to -PI to PI
      while (yawDiff > Math.PI) yawDiff -= Math.PI * 2;
      while (yawDiff < -Math.PI) yawDiff += Math.PI * 2;

      this.yaw += yawDiff * ENEMY_TURN_RATE * deltaTime;

      // Calculate target pitch (vertical angle)
      const horizDist = Math.sqrt(toTarget.x * toTarget.x + toTarget.z * toTarget.z);
      const targetPitch = -Math.atan2(toTarget.y, horizDist);
      const maxPitch = Math.PI * 0.4;
      const clampedTargetPitch = Math.max(-maxPitch, Math.min(maxPitch, targetPitch));

      this.pitch += (clampedTargetPitch - this.pitch) * 2 * deltaTime;

      // Roll into turns (banking)
      const targetRoll = -yawDiff * 0.5;
      const maxRoll = Math.PI * 0.3;
      this.roll += (Math.max(-maxRoll, Math.min(maxRoll, targetRoll)) - this.roll) * 3 * deltaTime;
    } else {
      // At target - level out
      this.pitch += (0 - this.pitch) * 2 * deltaTime;
      this.roll += (0 - this.roll) * 3 * deltaTime;
    }

    // Accelerate/decelerate towards target speed
    if (this.currentSpeed < this.targetSpeed) {
      this.currentSpeed += ENEMY_ACCELERATION * deltaTime;
      this.currentSpeed = Math.min(this.currentSpeed, this.targetSpeed);
    } else if (this.currentSpeed > this.targetSpeed) {
      this.currentSpeed -= ENEMY_ACCELERATION * 0.5 * deltaTime;
      this.currentSpeed = Math.max(this.currentSpeed, this.targetSpeed);
    }

    // Calculate forward direction from yaw and pitch
    const forward = new Vector3(
      Math.sin(this.yaw) * Math.cos(this.pitch),
      -Math.sin(this.pitch),
      Math.cos(this.yaw) * Math.cos(this.pitch)
    );

    // Set velocity based on speed and direction
    this.velocity = forward.scale(this.currentSpeed);
  }

  /**
   * Updates character rotation with banking effect
   */
  private updateCharacterRotation(_deltaTime: number): void {
    // Apply rotation to the root node
    this.root.rotation.y = this.yaw;
    this.root.rotation.x = this.pitch;
    this.root.rotation.z = this.roll;
  }

  /**
   * Updates flight visual effects based on speed
   */
  private updateFlightEffects(_deltaTime: number): void {
    // Update thruster intensity based on speed
    if (this.thrusterParticles) {
      const speedFactor = this.currentSpeed / ENEMY_MAX_SPEED;
      this.thrusterParticles.emitRate = 40 + speedFactor * 80;
      this.thrusterParticles.minEmitPower = 8 + speedFactor * 20;
      this.thrusterParticles.maxEmitPower = 15 + speedFactor * 30;
    }

    // Update speed particles (only at high speeds)
    if (this.speedParticles) {
      if (this.currentSpeed > 60) {
        const intensity = (this.currentSpeed - 60) / 100;
        this.speedParticles.emitRate = Math.min(80, intensity * 60);
      } else {
        this.speedParticles.emitRate = 0;
      }
    }

    // Trigger shockwave when crossing supersonic threshold
    const isAboveThreshold = this.currentSpeed > ENEMY_SHOCKWAVE_THRESHOLD;
    if (isAboveThreshold && !this.wasAboveShockwaveThreshold) {
      this.spawnShockwave();
    }
    this.wasAboveShockwaveThreshold = isAboveThreshold;
  }

  /**
   * Updates AI behavior
   */
  private updateAI(deltaTime: number, playerPosition: Vector3, buildings: Mesh[], now: number): void {
    const distToPlayer = Vector3.Distance(this.position, playerPosition);

    // State transitions
    if (this.health < ENEMY_MAX_HEALTH * 0.3 && distToPlayer < 100) {
      this.state = EnemyState.Flee;
    } else if (buildings.length > 0 && now - this.lastAttackTime > ENEMY_ATTACK_COOLDOWN) {
      this.state = EnemyState.Attack;
    } else {
      this.state = EnemyState.Patrol;
    }

    switch (this.state) {
      case EnemyState.Patrol:
        this.updatePatrol(deltaTime);
        this.hideHeatVision();
        break;
      case EnemyState.Attack:
        this.updateAttack(deltaTime, buildings, now);
        break;
      case EnemyState.Flee:
        this.updateFlee(deltaTime, playerPosition);
        this.hideHeatVision();
        break;
    }
  }

  /**
   * Updates patrol behavior
   */
  private updatePatrol(_deltaTime: number): void {
    const toTarget = this.targetPosition.subtract(this.position);
    const dist = toTarget.length();

    if (dist < 30) {
      this.setNewPatrolTarget();
      return;
    }

    // Fly fast during patrol - supersonic cruising
    this.targetSpeed = ENEMY_MIN_SPEED + (ENEMY_MAX_SPEED - ENEMY_MIN_SPEED) * 0.7;
  }

  /**
   * Updates attack behavior
   */
  private updateAttack(_deltaTime: number, buildings: Mesh[], now: number): void {
    // Find nearest building in a very wide search area
    let nearestBuilding: Mesh | null = null;
    let nearestDist = Infinity;
    const searchRange = 500;  // Search far for buildings

    for (const building of buildings) {
      const dist = Vector3.Distance(this.position, building.position);
      if (dist < nearestDist && dist < searchRange) {
        nearestDist = dist;
        nearestBuilding = building;
      }
    }

    if (!nearestBuilding) {
      // No buildings found, patrol around player
      this.state = EnemyState.Patrol;
      this.hideHeatVision();
      return;
    }

    // Set target to building position
    const toBuilding = nearestBuilding.position.subtract(this.position);
    toBuilding.y = 0;
    const horizDist = toBuilding.length();

    if (horizDist > ENEMY_ATTACK_RANGE) {
      // Fly toward building at max speed - supersonic attack run
      this.targetPosition = nearestBuilding.position.clone();
      this.targetPosition.y = Math.max(nearestBuilding.position.y + 25, ENEMY_HEIGHT_MIN);
      this.targetSpeed = ENEMY_MAX_SPEED;  // Full supersonic speed
      this.hideHeatVision();
    } else {
      // In range - slow down and attack
      this.targetSpeed = ENEMY_MIN_SPEED * 0.5;  // Near hover
      this.targetPosition = this.position.clone();  // Hold position

      // Attack!
      if (now - this.lastAttackTime > ENEMY_ATTACK_COOLDOWN) {
        this.fireHeatVision(nearestBuilding);
        this.lastAttackTime = now;
      }
    }
  }

  /**
   * Updates flee behavior
   */
  private updateFlee(_deltaTime: number, playerPosition: Vector3): void {
    const awayFromPlayer = this.position.subtract(playerPosition);
    awayFromPlayer.y = 0;
    if (awayFromPlayer.length() > 0.1) {
      awayFromPlayer.normalize();
    }

    // Set escape target far away from player
    this.targetPosition = this.position.add(awayFromPlayer.scale(200));
    this.targetPosition.y = ENEMY_HEIGHT_MAX + 30;  // Fly high to escape

    // Maximum escape speed - supersonic retreat
    this.targetSpeed = ENEMY_MAX_SPEED;
  }

  /**
   * Fires heat vision at a building - MASSIVE DESTRUCTIVE ATTACK
   */
  private fireHeatVision(target: Mesh): void {
    if (!this.heatVisionBeam) return;

    // Calculate distance and direction
    const toTarget = target.position.subtract(this.position);
    const dist = toTarget.length();

    // Show all beams - MASSIVE
    const beamMat = this.heatVisionBeam.material as StandardMaterial;
    beamMat.alpha = 0.85;
    this.heatVisionBeam.scaling.y = dist / 100;
    this.heatVisionBeam.position.z = dist / 2;

    // Left eye beam
    if (this.heatVisionBeamLeft) {
      const beamMatLeft = this.heatVisionBeamLeft.material as StandardMaterial;
      beamMatLeft.alpha = 0.8;
      this.heatVisionBeamLeft.scaling.y = dist / 100;
      this.heatVisionBeamLeft.position.z = dist / 2;
    }

    // Right eye beam
    if (this.heatVisionBeamRight) {
      const beamMatRight = this.heatVisionBeamRight.material as StandardMaterial;
      beamMatRight.alpha = 0.8;
      this.heatVisionBeamRight.scaling.y = dist / 100;
      this.heatVisionBeamRight.position.z = dist / 2;
    }

    // Position glow at impact point
    if (this.heatVisionGlow) {
      this.heatVisionGlow.position = target.position.clone();
      this.heatVisionGlow.position.y += 10;
      const glowMat = this.heatVisionGlow.material as StandardMaterial;
      glowMat.alpha = 0.9;

      // Pulse the glow
      const pulseScale = 1 + Math.sin(performance.now() * 0.02) * 0.3;
      this.heatVisionGlow.scaling = new Vector3(pulseScale, pulseScale, pulseScale);
    }

    // Start impact particles
    if (this.heatVisionParticles) {
      this.heatVisionParticles.emitRate = 150;
    }

    // Calculate force direction - FROM enemy TO target (push away from beam source)
    const forceDirection = toTarget.normalizeToNew();

    // MASSIVE DAMAGE with FORCE - destroys buildings and blows debris away
    if (this.onAttackBuilding) {
      // Main impact with powerful force
      this.onAttackBuilding(target.position, 200, forceDirection.scale(80));

      // Also damage nearby buildings in splash radius with radial force
      const splashRadius = 30;
      const splashDamage = 80;
      const angles = [0, Math.PI / 2, Math.PI, Math.PI * 1.5];
      for (const angle of angles) {
        const splashPos = target.position.clone();
        splashPos.x += Math.cos(angle) * splashRadius * 0.5;
        splashPos.z += Math.sin(angle) * splashRadius * 0.5;
        // Radial force from impact center
        const radialForce = new Vector3(
          Math.cos(angle) * 40,
          15,  // Some upward force
          Math.sin(angle) * 40
        );
        this.onAttackBuilding(splashPos, splashDamage, radialForce);
      }
    }

    // Camera shake from heat vision impact
    if (this.onCameraShake) {
      this.onCameraShake(3);
    }

    // Fade beams after attack
    setTimeout(() => {
      if (beamMat) beamMat.alpha = 0;
      if (this.heatVisionBeamLeft) {
        (this.heatVisionBeamLeft.material as StandardMaterial).alpha = 0;
      }
      if (this.heatVisionBeamRight) {
        (this.heatVisionBeamRight.material as StandardMaterial).alpha = 0;
      }
      if (this.heatVisionGlow) {
        (this.heatVisionGlow.material as StandardMaterial).alpha = 0;
      }
      if (this.heatVisionParticles) {
        this.heatVisionParticles.emitRate = 0;
      }
    }, 500);  // Longer attack duration
  }

  /**
   * Hides heat vision beam
   */
  private hideHeatVision(): void {
    if (this.heatVisionBeam) {
      const beamMat = this.heatVisionBeam.material as StandardMaterial;
      if (beamMat) beamMat.alpha = 0;
    }
    if (this.heatVisionBeamLeft) {
      const beamMat = this.heatVisionBeamLeft.material as StandardMaterial;
      if (beamMat) beamMat.alpha = 0;
    }
    if (this.heatVisionBeamRight) {
      const beamMat = this.heatVisionBeamRight.material as StandardMaterial;
      if (beamMat) beamMat.alpha = 0;
    }
    if (this.heatVisionGlow) {
      const glowMat = this.heatVisionGlow.material as StandardMaterial;
      if (glowMat) glowMat.alpha = 0;
    }
    if (this.heatVisionParticles) {
      this.heatVisionParticles.emitRate = 0;
    }
  }

  /**
   * Updates target indicator visibility
   */
  private updateTargetIndicator(deltaTime: number): void {
    if (!this.targetIndicator) return;

    const mat = this.targetIndicator.material as StandardMaterial;
    const targetAlpha = this.isTargeted ? 0.8 : 0;
    mat.alpha += (targetAlpha - mat.alpha) * 5 * deltaTime;

    // Spin when targeted
    if (this.isTargeted) {
      this.targetIndicator.rotation.z += 2 * deltaTime;
    }

    // Always face camera (billboard effect)
    this.targetIndicator.billboardMode = Mesh.BILLBOARDMODE_ALL;
  }

  /**
   * Sets whether enemy is currently targeted by player
   */
  public setTargeted(targeted: boolean): void {
    this.isTargeted = targeted;
  }

  // Getters
  public getPosition(): Vector3 {
    return this.position.clone();
  }

  public getHealth(): number {
    return this.health;
  }

  public getMaxHealth(): number {
    return ENEMY_MAX_HEALTH;
  }

  public isDead(): boolean {
    return this.state === EnemyState.Dead;
  }

  public isAlive(): boolean {
    return this.state !== EnemyState.Dead;
  }

  public getRoot(): TransformNode {
    return this.root;
  }

  /**
   * Cleans up resources
   */
  public dispose(): void {
    if (this.thrusterParticles) {
      this.thrusterParticles.dispose();
    }
    if (this.speedParticles) {
      this.speedParticles.dispose();
    }
    if (this.heatVisionParticles) {
      this.heatVisionParticles.dispose();
    }
    for (const mesh of this.bodyMeshes) {
      mesh.dispose();
    }
    for (const ring of this.shockwaveRings) {
      ring.dispose();
    }
    if (this.heatVisionBeam) {
      this.heatVisionBeam.dispose();
    }
    if (this.heatVisionBeamLeft) {
      this.heatVisionBeamLeft.dispose();
    }
    if (this.heatVisionBeamRight) {
      this.heatVisionBeamRight.dispose();
    }
    if (this.heatVisionGlow) {
      this.heatVisionGlow.dispose();
    }
    if (this.targetIndicator) {
      this.targetIndicator.dispose();
    }
    this.root.dispose();
  }
}
