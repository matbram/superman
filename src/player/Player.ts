/**
 * Player - Main player controller class
 * Manages state machine, physics, mesh, and camera
 */

import { Scene } from '@babylonjs/core/scene';
import { Vector3, Quaternion } from '@babylonjs/core/Maths/math.vector';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { ParticleSystem } from '@babylonjs/core/Particles/particleSystem';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import { FreeCamera } from '@babylonjs/core/Cameras/freeCamera';
import { ShadowGenerator } from '@babylonjs/core/Lights/Shadows/shadowGenerator';

import { PhysicsManager, CharacterPhysics } from '../physics/physics';
import { InputState } from '../input/actionMap';
import { CameraController } from './CameraController';
import { IPlayerState, PlayerStateType } from './PlayerState';
import { GroundedState } from './states/GroundedState';
import { TakeoffState } from './states/TakeoffState';
import { FlightState } from './states/FlightState';
import { HoverState } from './states/HoverState';
import { LandingState } from './states/LandingState';

// Player physical properties
const PLAYER_HEIGHT = 1.8;
const PLAYER_RADIUS = 0.4;

// Speed effect thresholds
const SPEED_PARTICLE_THRESHOLD = 40;  // When speed particles start
const SHOCKWAVE_THRESHOLD = 120;      // When shockwave ring appears
const STOP_SHOCKWAVE_RADIUS = 50;     // Radius of destructive stop shockwave

export class Player {
  private scene: Scene;
  private physicsManager: PhysicsManager;
  private cameraController: CameraController;

  // Visual representation
  private rootNode: TransformNode;
  private bodyMesh: Mesh;
  private capeMesh: Mesh;

  // Physics body
  private physics: CharacterPhysics;

  // Orientation (Euler angles)
  private yaw: number = 0;
  private pitch: number = 0;
  private roll: number = 0;

  // State machine
  private states: Map<PlayerStateType, IPlayerState>;
  private currentState: IPlayerState;

  // Flight effects
  private isFlightMode: boolean = false;
  private isBoostActive: boolean = false;
  private currentSpeed: number = 0;
  private speedParticles: ParticleSystem | null = null;
  private takeoffParticles: ParticleSystem | null = null;

  // Shockwave visual effect - triggers once when crossing sonic threshold
  private shockwaveRings: Mesh[] = [];
  private wasAboveSonicThreshold: boolean = false;

  // Stop shockwave for building damage
  private onBuildingDamage: ((position: Vector3, radius: number, force: number) => void) | null = null;

  // Audio (placeholder for future implementation)
  // TODO: Add wind audio that scales with speed

  constructor(
    scene: Scene,
    physicsManager: PhysicsManager,
    camera: FreeCamera,
    shadowGenerator: ShadowGenerator
  ) {
    this.scene = scene;
    this.physicsManager = physicsManager;

    // Create player visuals
    this.rootNode = new TransformNode('playerRoot', scene);
    this.bodyMesh = this.createBodyMesh();
    this.capeMesh = this.createCapeMesh();

    // Add to shadow caster
    shadowGenerator.addShadowCaster(this.bodyMesh);
    shadowGenerator.addShadowCaster(this.capeMesh);

    // Initialize physics body
    this.physics = {
      position: new Vector3(0, PLAYER_HEIGHT / 2, 0),
      velocity: Vector3.Zero(),
      radius: PLAYER_RADIUS,
      height: PLAYER_HEIGHT,
      isGrounded: false,
      groundNormal: Vector3.Up(),
    };

    // Initialize camera controller
    this.cameraController = new CameraController(camera);

    // Create speed effect particles
    this.createSpeedParticles();
    this.createTakeoffParticles();

    // Initialize state machine
    this.states = new Map<PlayerStateType, IPlayerState>();
    this.states.set(PlayerStateType.Grounded, new GroundedState());
    this.states.set(PlayerStateType.Takeoff, new TakeoffState());
    this.states.set(PlayerStateType.Flight, new FlightState());
    this.states.set(PlayerStateType.Hover, new HoverState());
    this.states.set(PlayerStateType.Landing, new LandingState());

    this.currentState = this.states.get(PlayerStateType.Grounded)!;
    this.currentState.enter(this);

    // Set initial position
    this.setPosition(new Vector3(0, 2, 0));
  }

  /**
   * Creates the player body mesh (simple capsule-like shape)
   */
  private createBodyMesh(): Mesh {
    // Create a simple humanoid shape from primitives
    const body = MeshBuilder.CreateCapsule('playerBody', {
      height: PLAYER_HEIGHT,
      radius: PLAYER_RADIUS,
    }, this.scene);

    const material = new StandardMaterial('playerMaterial', this.scene);
    material.diffuseColor = new Color3(0.2, 0.3, 0.8); // Blue suit
    material.specularColor = new Color3(0.3, 0.3, 0.3);

    body.material = material;
    body.parent = this.rootNode;

    return body;
  }

  /**
   * Creates a simple cape mesh
   */
  private createCapeMesh(): Mesh {
    const cape = MeshBuilder.CreateBox('playerCape', {
      width: 0.8,
      height: 1.2,
      depth: 0.1,
    }, this.scene);

    const material = new StandardMaterial('capeMaterial', this.scene);
    material.diffuseColor = new Color3(0.8, 0.1, 0.1); // Red cape
    material.specularColor = new Color3(0.2, 0.2, 0.2);

    cape.material = material;
    cape.parent = this.rootNode;
    cape.position = new Vector3(0, 0.2, -0.3);

    return cape;
  }

  /**
   * Creates speed streak particle system
   */
  private createSpeedParticles(): void {
    this.speedParticles = new ParticleSystem('speedParticles', 100, this.scene);

    // Use a simple white texture or create procedurally
    this.speedParticles.particleTexture = new Texture('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAAA0SURBVChTY/z//z8DEwMBwESAAOggFgZCYNQEXABZE4omnCbgNQGvCTiB0AS8JuA0gYEBAGqkBQm7+hkOAAAAAElFTkSuQmCC', this.scene);

    // Emission from player position (use body mesh as emitter)
    this.speedParticles.emitter = this.bodyMesh;
    this.speedParticles.minEmitBox = new Vector3(-0.5, -0.5, -0.5);
    this.speedParticles.maxEmitBox = new Vector3(0.5, 0.5, 0.5);

    // Particle properties
    this.speedParticles.color1 = new Color3(1, 1, 1).toColor4(0.5);
    this.speedParticles.color2 = new Color3(0.8, 0.9, 1).toColor4(0.3);
    this.speedParticles.colorDead = new Color3(1, 1, 1).toColor4(0);

    this.speedParticles.minSize = 0.05;
    this.speedParticles.maxSize = 0.15;

    this.speedParticles.minLifeTime = 0.1;
    this.speedParticles.maxLifeTime = 0.3;

    this.speedParticles.emitRate = 0; // Start with no particles

    this.speedParticles.blendMode = ParticleSystem.BLENDMODE_ADD;

    // Direction (behind player)
    this.speedParticles.direction1 = new Vector3(-1, -0.5, -1);
    this.speedParticles.direction2 = new Vector3(1, 0.5, -1);
    this.speedParticles.minEmitPower = 5;
    this.speedParticles.maxEmitPower = 10;

    this.speedParticles.updateSpeed = 0.02;

    this.speedParticles.start();
  }

  /**
   * Creates takeoff burst particle system
   */
  private createTakeoffParticles(): void {
    this.takeoffParticles = new ParticleSystem('takeoffParticles', 50, this.scene);

    this.takeoffParticles.particleTexture = new Texture('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAAA0SURBVChTY/z//z8DEwMBwESAAOggFgZCYNQEXABZE4omnCbgNQGvCTiB0AS8JuA0gYEBAGqkBQm7+hkOAAAAAElFTkSuQmCC', this.scene);

    this.takeoffParticles.emitter = this.bodyMesh;
    this.takeoffParticles.minEmitBox = new Vector3(-0.3, -0.9, -0.3);
    this.takeoffParticles.maxEmitBox = new Vector3(0.3, -0.9, 0.3);

    this.takeoffParticles.color1 = new Color3(1, 0.8, 0.2).toColor4(0.8);
    this.takeoffParticles.color2 = new Color3(1, 0.5, 0.1).toColor4(0.6);
    this.takeoffParticles.colorDead = new Color3(1, 0.3, 0).toColor4(0);

    this.takeoffParticles.minSize = 0.2;
    this.takeoffParticles.maxSize = 0.5;

    this.takeoffParticles.minLifeTime = 0.3;
    this.takeoffParticles.maxLifeTime = 0.6;

    this.takeoffParticles.emitRate = 0;
    this.takeoffParticles.blendMode = ParticleSystem.BLENDMODE_ADD;

    this.takeoffParticles.direction1 = new Vector3(-0.5, -1, -0.5);
    this.takeoffParticles.direction2 = new Vector3(0.5, -1, 0.5);
    this.takeoffParticles.minEmitPower = 3;
    this.takeoffParticles.maxEmitPower = 6;

    this.takeoffParticles.start();
  }

  /**
   * Creates a shockwave ring mesh for visual effect
   */
  private createShockwaveRing(): Mesh {
    // Create a torus (ring) for the shockwave
    const ring = MeshBuilder.CreateTorus('shockwave', {
      diameter: 2,
      thickness: 0.15,
      tessellation: 32,
    }, this.scene);

    const material = new StandardMaterial('shockwaveMat', this.scene);
    material.diffuseColor = new Color3(0.8, 0.9, 1);
    material.emissiveColor = new Color3(0.5, 0.7, 1);
    material.specularColor = new Color3(1, 1, 1);
    material.alpha = 0.8;

    ring.material = material;
    ring.isPickable = false;
    ring.visibility = 0;

    return ring;
  }

  /**
   * Spawns a shockwave ring that expands outward
   */
  private spawnShockwave(): void {
    const ring = this.createShockwaveRing();
    ring.position.copyFrom(this.physics.position);
    ring.rotation.x = Math.PI / 2; // Lay flat perpendicular to flight direction
    ring.rotation.y = this.yaw;
    ring.scaling = new Vector3(1, 1, 1);
    ring.visibility = 1;

    this.shockwaveRings.push(ring);

    // Add camera shake for impact
    this.cameraController.addShake(1.5);
  }

  /**
   * Creates a destructive stop shockwave ring (red/orange, larger)
   */
  private createStopShockwaveRing(): Mesh {
    const ring = MeshBuilder.CreateTorus('stopShockwave', {
      diameter: 5,
      thickness: 0.4,
      tessellation: 48,
    }, this.scene);

    const material = new StandardMaterial('stopShockwaveMat', this.scene);
    material.diffuseColor = new Color3(1, 0.4, 0.1);
    material.emissiveColor = new Color3(1, 0.3, 0);
    material.specularColor = new Color3(1, 0.5, 0.2);
    material.alpha = 0.9;

    ring.material = material;
    ring.isPickable = false;
    ring.visibility = 0;

    return ring;
  }

  /**
   * Spawns a destructive stop shockwave when abruptly stopping from high speed
   */
  private spawnStopShockwave(previousSpeed: number): void {
    // Create multiple expanding rings for dramatic effect
    for (let i = 0; i < 3; i++) {
      const ring = this.createStopShockwaveRing();
      ring.position.copyFrom(this.physics.position);
      ring.rotation.x = Math.PI / 2;
      ring.scaling = new Vector3(1 + i * 0.5, 1 + i * 0.5, 1 + i * 0.5);
      ring.visibility = 1;

      this.shockwaveRings.push(ring);
    }

    // Intense camera shake
    const shakeIntensity = Math.min(5, previousSpeed / 30);
    this.cameraController.addShake(shakeIntensity);

    // Trigger building damage in radius
    if (this.onBuildingDamage) {
      const force = previousSpeed / 50; // Damage force based on speed
      this.onBuildingDamage(this.physics.position.clone(), STOP_SHOCKWAVE_RADIUS, force);
    }
  }

  /**
   * Updates shockwave rings (expand and fade)
   */
  private updateShockwaves(deltaTime: number): void {
    const expandSpeed = 15;
    const fadeSpeed = 3;

    for (let i = this.shockwaveRings.length - 1; i >= 0; i--) {
      const ring = this.shockwaveRings[i];

      // Expand the ring
      ring.scaling.x += expandSpeed * deltaTime;
      ring.scaling.y += expandSpeed * deltaTime;
      ring.scaling.z += expandSpeed * deltaTime;

      // Fade out
      ring.visibility -= fadeSpeed * deltaTime;

      // Remove when invisible
      if (ring.visibility <= 0) {
        ring.dispose();
        this.shockwaveRings.splice(i, 1);
      }
    }
  }

  /**
   * Updates player each frame
   */
  public update(input: InputState, deltaTime: number): void {
    // Update current state
    const nextStateType = this.currentState.update(this, input, deltaTime);

    // Handle state transition
    if (nextStateType !== null) {
      this.transitionToState(nextStateType);
    }

    // Update physics
    this.physicsManager.fixedUpdate(deltaTime, (fixedDelta) => {
      this.currentState.fixedUpdate(this, input, fixedDelta);
      this.applyPhysics(fixedDelta);
    });

    // Update visual representation
    this.updateVisuals(deltaTime);

    // Update effects
    this.updateEffects(deltaTime);

    // Update camera
    this.cameraController.setTarget(this.physics.position, this.getForwardDirection());
    this.cameraController.setFlightMode(this.isFlightMode);
    this.cameraController.setSpeed(this.currentSpeed);
    this.cameraController.update(deltaTime);
  }

  /**
   * Transitions to a new state
   */
  private transitionToState(newStateType: PlayerStateType): void {
    const newState = this.states.get(newStateType);
    if (!newState) {
      console.error(`Unknown state: ${newStateType}`);
      return;
    }

    const previousStateType = this.currentState.type;
    const previousSpeed = this.currentSpeed;

    this.currentState.exit(this);
    this.currentState = newState;
    this.currentState.enter(this);

    // Trigger flight stop camera effect when transitioning from Flight to Hover
    if (previousStateType === PlayerStateType.Flight && newStateType === PlayerStateType.Hover) {
      this.cameraController.triggerFlightStopEffect(previousSpeed);

      // Spawn destructive stop shockwave if was flying above sonic speed
      if (previousSpeed > SHOCKWAVE_THRESHOLD) {
        this.spawnStopShockwave(previousSpeed);
      }
    }

    // Also trigger stop shockwave if transitioning from Flight to Landing at high speed
    if (previousStateType === PlayerStateType.Flight && newStateType === PlayerStateType.Landing) {
      if (previousSpeed > SHOCKWAVE_THRESHOLD) {
        this.spawnStopShockwave(previousSpeed);
      }
    }
  }

  /**
   * Applies physics simulation
   */
  private applyPhysics(deltaTime: number): void {
    // Update physics body with collision detection
    this.physicsManager.updateCharacter(
      this.physics,
      this.physics.velocity,
      deltaTime
    );
  }

  /**
   * Updates visual representation to match physics
   */
  private updateVisuals(deltaTime: number): void {
    // Update root node position
    this.rootNode.position.copyFrom(this.physics.position);

    // Create rotation from euler angles
    const rotation = Quaternion.RotationYawPitchRoll(this.yaw, this.pitch, this.roll);
    this.rootNode.rotationQuaternion = rotation;

    // Animate cape based on speed and movement
    this.animateCape(deltaTime);
  }

  /**
   * Animates the cape based on movement
   */
  private animateCape(deltaTime: number): void {
    // Cape flows behind during flight
    const capeAngle = Math.min(0.8, this.currentSpeed * 0.01);
    const targetRotX = this.isFlightMode ? capeAngle : 0;

    // Add some flutter
    const flutter = Math.sin(performance.now() * 0.01) * 0.1 * (this.isFlightMode ? 1 : 0.3);

    this.capeMesh.rotation.x = this.lerp(
      this.capeMesh.rotation.x,
      targetRotX + flutter,
      5 * deltaTime
    );
  }

  /**
   * Updates visual effects based on speed
   */
  private updateEffects(deltaTime: number): void {
    // Speed particles (subtle at lower speeds)
    if (this.speedParticles) {
      if (this.currentSpeed > SPEED_PARTICLE_THRESHOLD && this.isFlightMode) {
        const intensity = (this.currentSpeed - SPEED_PARTICLE_THRESHOLD) / 50;
        this.speedParticles.emitRate = Math.min(100, intensity * 50);
      } else {
        this.speedParticles.emitRate = 0;
      }
    }

    // Update existing shockwave rings
    this.updateShockwaves(deltaTime);

    // Spawn shockwave ONCE when crossing the sonic threshold
    const isAboveSonicThreshold = this.currentSpeed > SHOCKWAVE_THRESHOLD && this.isFlightMode;
    if (isAboveSonicThreshold && !this.wasAboveSonicThreshold) {
      // Just crossed the threshold - spawn a single shockwave
      this.spawnShockwave();
    }
    this.wasAboveSonicThreshold = isAboveSonicThreshold;

    // Camera shake at high speed near ground
    if (this.currentSpeed > 80 && this.isFlightMode) {
      const height = this.getHeightAboveGround();
      if (height < 15) {
        const shakeIntensity = (1 - height / 15) * 0.8 * (this.currentSpeed / 100);
        this.cameraController.addShake(shakeIntensity);
      }
    }
  }

  /**
   * Starts takeoff effect
   */
  public startTakeoffEffect(): void {
    if (this.takeoffParticles) {
      this.takeoffParticles.emitRate = 50;
      setTimeout(() => {
        if (this.takeoffParticles) {
          this.takeoffParticles.emitRate = 0;
        }
      }, 400);
    }
  }

  // ============ Getters/Setters ============

  public getPosition(): Vector3 {
    return this.physics.position.clone();
  }

  public setPosition(pos: Vector3): void {
    this.physics.position.copyFrom(pos);
    this.rootNode.position.copyFrom(pos);
    this.cameraController.resetToDefault(pos, this.getForwardDirection());
  }

  public getVelocity(): Vector3 {
    return this.physics.velocity;
  }

  public setVelocity(vel: Vector3): void {
    this.physics.velocity = vel;
  }

  public getYaw(): number {
    return this.yaw;
  }

  public setYaw(yaw: number): void {
    this.yaw = yaw;
  }

  public getPitch(): number {
    return this.pitch;
  }

  public setPitch(pitch: number): void {
    this.pitch = pitch;
  }

  public getRoll(): number {
    return this.roll;
  }

  public setRoll(roll: number): void {
    this.roll = roll;
  }

  public getForwardDirection(): Vector3 {
    // Calculate forward direction from yaw and pitch
    const forward = new Vector3(
      Math.sin(this.yaw) * Math.cos(this.pitch),
      -Math.sin(this.pitch),
      Math.cos(this.yaw) * Math.cos(this.pitch)
    );
    return forward.normalize();
  }

  public getCameraForward(): Vector3 {
    return this.cameraController.getCameraForward();
  }

  public getCameraRight(): Vector3 {
    return this.cameraController.getCameraRight();
  }

  public rotateCameraYaw(delta: number): void {
    this.cameraController.rotateYaw(delta);
  }

  public rotateCameraPitch(delta: number): void {
    this.cameraController.rotatePitch(delta);
  }

  public isGrounded(): boolean {
    return this.physics.isGrounded;
  }

  public getHeightAboveGround(): number {
    const rayResult = this.physicsManager.raycast(
      this.physics.position,
      Vector3.Down(),
      100
    );
    return rayResult.hit ? rayResult.distance : 100;
  }

  public getPhysics(): PhysicsManager {
    return this.physicsManager;
  }

  public setFlightMode(isFlying: boolean): void {
    this.isFlightMode = isFlying;
  }

  public setBoostActive(active: boolean): void {
    this.isBoostActive = active;
  }

  public isBoost(): boolean {
    return this.isBoostActive;
  }

  public setCurrentSpeed(speed: number): void {
    this.currentSpeed = speed;
  }

  public getCurrentSpeed(): number {
    return this.currentSpeed;
  }

  public getCurrentStateType(): PlayerStateType {
    return this.currentState.type;
  }

  /**
   * Sets callback for building damage from stop shockwave
   */
  public setOnBuildingDamage(callback: (position: Vector3, radius: number, force: number) => void): void {
    this.onBuildingDamage = callback;
  }

  private lerp(a: number, b: number, t: number): number {
    return a + (b - a) * Math.min(1, Math.max(0, t));
  }
}
