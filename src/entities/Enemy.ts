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

// Enemy constants
const ENEMY_MAX_HEALTH = 500;
const ENEMY_FLIGHT_SPEED = 60;
const ENEMY_ATTACK_RANGE = 80;
const ENEMY_ATTACK_COOLDOWN = 2000;  // ms between attacks
const ENEMY_PATROL_RADIUS = 300;
const ENEMY_HEIGHT_MIN = 40;
const ENEMY_HEIGHT_MAX = 120;

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
  private root: TransformNode;
  private bodyMeshes: Mesh[] = [];
  private position: Vector3 = new Vector3(0, 60, 100);
  private velocity: Vector3 = Vector3.Zero();
  private targetPosition: Vector3 = Vector3.Zero();

  // Stats
  private health: number = ENEMY_MAX_HEALTH;
  private state: EnemyState = EnemyState.Patrol;
  private lastAttackTime: number = 0;

  // Visual
  private heatVisionBeam: Mesh | null = null;
  private thrusterParticles: ParticleSystem | null = null;

  // Callbacks
  private onAttackBuilding: ((position: Vector3, damage: number) => void) | null = null;
  private onDeath: (() => void) | null = null;

  // Target indicator
  private targetIndicator: Mesh | null = null;
  private isTargeted: boolean = false;

  constructor(scene: Scene, spawnPosition?: Vector3) {
    this.scene = scene;
    this.root = new TransformNode('enemy', scene);

    if (spawnPosition) {
      this.position = spawnPosition.clone();
    }

    this.root.position = this.position;

    this.createVillainModel();
    this.createThrusterEffect();
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

    const V = 0.45;  // Voxel size - matches player

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
    this.thrusterParticles.minEmitBox = new Vector3(-0.3, -1, -0.3);
    this.thrusterParticles.maxEmitBox = new Vector3(0.3, -1, 0.3);

    this.thrusterParticles.color1 = new Color3(0.6, 0.1, 0.8).toColor4(0.8);  // Purple
    this.thrusterParticles.color2 = new Color3(0.8, 0.2, 1).toColor4(0.6);
    this.thrusterParticles.colorDead = new Color3(0.3, 0, 0.4).toColor4(0);

    this.thrusterParticles.minSize = 0.3;
    this.thrusterParticles.maxSize = 0.6;
    this.thrusterParticles.minLifeTime = 0.2;
    this.thrusterParticles.maxLifeTime = 0.4;

    this.thrusterParticles.emitRate = 40;
    this.thrusterParticles.blendMode = ParticleSystem.BLENDMODE_ADD;

    this.thrusterParticles.direction1 = new Vector3(-0.3, -1, -0.3);
    this.thrusterParticles.direction2 = new Vector3(0.3, -1, 0.3);
    this.thrusterParticles.minEmitPower = 4;
    this.thrusterParticles.maxEmitPower = 8;

    this.thrusterParticles.start();
  }

  /**
   * Creates the heat vision beam for attacking
   */
  private createHeatVisionBeam(): void {
    this.heatVisionBeam = MeshBuilder.CreateCylinder('enemyHeatBeam', {
      diameterTop: 0.3,
      diameterBottom: 0.8,
      height: 50,
      tessellation: 8
    }, this.scene);

    const beamMat = new StandardMaterial('enemyBeamMat', this.scene);
    beamMat.diffuseColor = new Color3(0.8, 0.1, 1);  // Purple beam
    beamMat.emissiveColor = new Color3(0.6, 0.1, 0.8);
    beamMat.alpha = 0;
    beamMat.backFaceCulling = false;

    this.heatVisionBeam.material = beamMat;
    this.heatVisionBeam.parent = this.root;
    this.heatVisionBeam.position.y = 2.5;
    this.heatVisionBeam.rotation.x = Math.PI / 2;
    this.heatVisionBeam.position.z = 25;
    this.heatVisionBeam.isPickable = false;
  }

  /**
   * Creates target indicator for lock-on system
   */
  private createTargetIndicator(): void {
    // Create diamond-shaped target indicator
    this.targetIndicator = MeshBuilder.CreateBox('targetIndicator', {
      width: 4, height: 4, depth: 0.2
    }, this.scene);

    const indicatorMat = new StandardMaterial('targetMat', this.scene);
    indicatorMat.diffuseColor = new Color3(1, 0.2, 0.2);
    indicatorMat.emissiveColor = new Color3(0.8, 0.1, 0.1);
    indicatorMat.alpha = 0;
    indicatorMat.backFaceCulling = false;

    this.targetIndicator.material = indicatorMat;
    this.targetIndicator.rotation.z = Math.PI / 4;  // Diamond shape
    this.targetIndicator.parent = this.root;
    this.targetIndicator.position.y = 5;
    this.targetIndicator.isPickable = false;
  }

  /**
   * Sets a new random patrol target
   */
  private setNewPatrolTarget(): void {
    const angle = Math.random() * Math.PI * 2;
    const radius = ENEMY_PATROL_RADIUS * (0.5 + Math.random() * 0.5);

    this.targetPosition = new Vector3(
      Math.cos(angle) * radius,
      ENEMY_HEIGHT_MIN + Math.random() * (ENEMY_HEIGHT_MAX - ENEMY_HEIGHT_MIN),
      Math.sin(angle) * radius
    );
  }

  /**
   * Sets callback for when enemy attacks a building
   */
  public setOnAttackBuilding(callback: (position: Vector3, damage: number) => void): void {
    this.onAttackBuilding = callback;
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

    // Update AI behavior
    this.updateAI(deltaTime, playerPosition, buildings, now);

    // Update position
    this.position.addInPlace(this.velocity.scale(deltaTime));
    this.root.position = this.position;

    // Face direction of movement
    if (this.velocity.length() > 1) {
      const lookDir = this.velocity.clone();
      lookDir.y = 0;
      if (lookDir.length() > 0.1) {
        lookDir.normalize();
        this.root.rotation.y = Math.atan2(lookDir.x, lookDir.z);
      }
    }

    // Update target indicator
    this.updateTargetIndicator(deltaTime);
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
  private updatePatrol(deltaTime: number): void {
    const toTarget = this.targetPosition.subtract(this.position);
    const dist = toTarget.length();

    if (dist < 20) {
      this.setNewPatrolTarget();
      return;
    }

    const direction = toTarget.normalize();
    const targetVelocity = direction.scale(ENEMY_FLIGHT_SPEED);

    this.velocity = Vector3.Lerp(this.velocity, targetVelocity, 2 * deltaTime);
  }

  /**
   * Updates attack behavior
   */
  private updateAttack(deltaTime: number, buildings: Mesh[], now: number): void {
    // Find nearest building
    let nearestBuilding: Mesh | null = null;
    let nearestDist = Infinity;

    for (const building of buildings) {
      const dist = Vector3.Distance(this.position, building.position);
      if (dist < nearestDist && dist < ENEMY_ATTACK_RANGE * 2) {
        nearestDist = dist;
        nearestBuilding = building;
      }
    }

    if (!nearestBuilding) {
      this.state = EnemyState.Patrol;
      this.hideHeatVision();
      return;
    }

    // Move toward building
    const toBuilding = nearestBuilding.position.subtract(this.position);
    toBuilding.y = 0;
    const horizDist = toBuilding.length();

    if (horizDist > ENEMY_ATTACK_RANGE) {
      // Fly toward building
      const direction = toBuilding.normalize();
      const targetVelocity = direction.scale(ENEMY_FLIGHT_SPEED * 0.8);
      targetVelocity.y = (ENEMY_HEIGHT_MIN + 30 - this.position.y) * 2;
      this.velocity = Vector3.Lerp(this.velocity, targetVelocity, 2 * deltaTime);
      this.hideHeatVision();
    } else {
      // In range - hover and attack
      this.velocity = Vector3.Lerp(this.velocity, Vector3.Zero(), 3 * deltaTime);

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
  private updateFlee(deltaTime: number, playerPosition: Vector3): void {
    const awayFromPlayer = this.position.subtract(playerPosition);
    awayFromPlayer.y = 0;
    awayFromPlayer.normalize();

    const targetVelocity = awayFromPlayer.scale(ENEMY_FLIGHT_SPEED * 1.2);
    targetVelocity.y = (ENEMY_HEIGHT_MAX - this.position.y) * 2;  // Fly high to escape

    this.velocity = Vector3.Lerp(this.velocity, targetVelocity, 3 * deltaTime);
  }

  /**
   * Fires heat vision at a building
   */
  private fireHeatVision(target: Mesh): void {
    if (!this.heatVisionBeam) return;

    // Show beam
    const beamMat = this.heatVisionBeam.material as StandardMaterial;
    beamMat.alpha = 0.7;

    // Point at target
    const toTarget = target.position.subtract(this.position);
    const dist = toTarget.length();

    this.heatVisionBeam.scaling.y = dist / 50;
    this.heatVisionBeam.position.z = dist / 2;

    // Damage building
    if (this.onAttackBuilding) {
      this.onAttackBuilding(target.position, 40);
    }

    // Fade beam
    setTimeout(() => {
      if (beamMat) beamMat.alpha = 0;
    }, 300);
  }

  /**
   * Hides heat vision beam
   */
  private hideHeatVision(): void {
    if (this.heatVisionBeam) {
      const beamMat = this.heatVisionBeam.material as StandardMaterial;
      if (beamMat) beamMat.alpha = 0;
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
    for (const mesh of this.bodyMeshes) {
      mesh.dispose();
    }
    if (this.heatVisionBeam) {
      this.heatVisionBeam.dispose();
    }
    if (this.targetIndicator) {
      this.targetIndicator.dispose();
    }
    this.root.dispose();
  }
}
