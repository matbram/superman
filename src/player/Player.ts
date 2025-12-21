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
import { VoxelCharacter } from './VoxelCharacter';
import { HeatVision } from './HeatVision';

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
  private voxelCharacter: VoxelCharacter;

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

  // Wind breaking effect - visible air compression in front during flight
  private windBreakCone: Mesh | null = null;
  private windBreakRings: Mesh[] = [];

  // Stop shockwave for building damage
  private onBuildingDamage: ((position: Vector3, radius: number, force: number) => void) | null = null;

  // Building collision damage callback
  private onBuildingCollision: ((buildingMesh: any, impactPosition: Vector3, speed: number) => void) | null = null;
  private lastBuildingCollisionTime: number = 0;

  // Heat vision
  private heatVision: HeatVision;

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
    this.voxelCharacter = new VoxelCharacter(scene, shadowGenerator);

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
    this.createWindBreakEffect();

    // Initialize heat vision
    this.heatVision = new HeatVision(scene, physicsManager);

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
   * Creates speed streak particle system
   */
  private createSpeedParticles(): void {
    this.speedParticles = new ParticleSystem('speedParticles', 100, this.scene);

    // Use a simple white texture or create procedurally
    this.speedParticles.particleTexture = new Texture('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAAA0SURBVChTY/z//z8DEwMBwESAAOggFgZCYNQEXABZE4omnCbgNQGvCTiB0AS8JuA0gYEBAGqkBQm7+hkOAAAAAElFTkSuQmCC', this.scene);

    // Emission from player position (use voxel character body as emitter)
    this.speedParticles.emitter = this.voxelCharacter.getEmitterMesh();
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

    this.takeoffParticles.emitter = this.voxelCharacter.getEmitterMesh();
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
   * Creates wind breaking effect - visible air compression cone and rings in front of player
   */
  private createWindBreakEffect(): void {
    // Create main compression cone in front of player
    this.windBreakCone = MeshBuilder.CreateCylinder('windBreakCone', {
      diameterTop: 0,
      diameterBottom: 3,
      height: 4,
      tessellation: 16,
    }, this.scene);

    const coneMaterial = new StandardMaterial('windConeMat', this.scene);
    coneMaterial.diffuseColor = new Color3(0.9, 0.95, 1);
    coneMaterial.emissiveColor = new Color3(0.3, 0.5, 0.8);
    coneMaterial.specularColor = new Color3(1, 1, 1);
    coneMaterial.alpha = 0;
    coneMaterial.backFaceCulling = false;

    this.windBreakCone.material = coneMaterial;
    this.windBreakCone.isPickable = false;
    this.windBreakCone.parent = this.rootNode;
    // Position in front of player, tip pointing forward
    this.windBreakCone.rotation.x = Math.PI / 2;
    this.windBreakCone.position = new Vector3(0, 0, 3);

    // Create compression rings that follow the player
    for (let i = 0; i < 3; i++) {
      const ring = MeshBuilder.CreateTorus('windRing_' + i, {
        diameter: 1.5 + i * 0.8,
        thickness: 0.08,
        tessellation: 24,
      }, this.scene);

      const ringMaterial = new StandardMaterial('windRingMat_' + i, this.scene);
      ringMaterial.diffuseColor = new Color3(0.85, 0.9, 1);
      ringMaterial.emissiveColor = new Color3(0.4, 0.6, 0.9);
      ringMaterial.alpha = 0;
      ringMaterial.backFaceCulling = false;

      ring.material = ringMaterial;
      ring.isPickable = false;
      ring.parent = this.rootNode;
      ring.position = new Vector3(0, 0, 2 + i * 1.2);

      this.windBreakRings.push(ring);
    }
  }

  /**
   * Updates wind breaking effect based on speed
   */
  private updateWindBreakEffect(deltaTime: number): void {
    const WIND_BREAK_START_SPEED = 50;  // Speed at which effect starts appearing
    const WIND_BREAK_FULL_SPEED = 150;  // Speed at which effect is fully visible

    if (!this.windBreakCone || !this.isFlightMode) {
      // Hide effect when not in flight
      if (this.windBreakCone) {
        (this.windBreakCone.material as StandardMaterial).alpha = 0;
      }
      for (const ring of this.windBreakRings) {
        (ring.material as StandardMaterial).alpha = 0;
      }
      return;
    }

    // Calculate effect intensity based on speed
    let intensity = 0;
    if (this.currentSpeed > WIND_BREAK_START_SPEED) {
      intensity = Math.min(1, (this.currentSpeed - WIND_BREAK_START_SPEED) / (WIND_BREAK_FULL_SPEED - WIND_BREAK_START_SPEED));
    }

    // Update cone visibility and scale
    const coneMat = this.windBreakCone.material as StandardMaterial;
    const targetConeAlpha = intensity * 0.25;  // Subtle transparency
    coneMat.alpha = this.lerp(coneMat.alpha, targetConeAlpha, 5 * deltaTime);

    // Scale cone based on speed - gets more pronounced at higher speeds
    const coneScale = 0.8 + intensity * 0.5;
    this.windBreakCone.scaling = new Vector3(coneScale, coneScale, coneScale + intensity * 0.3);

    // Pulse effect for intensity
    const pulseTime = performance.now() * 0.003;
    const pulse = 1 + Math.sin(pulseTime) * 0.1 * intensity;

    // Update rings with wave animation
    for (let i = 0; i < this.windBreakRings.length; i++) {
      const ring = this.windBreakRings[i];
      const ringMat = ring.material as StandardMaterial;

      // Stagger ring visibility
      const ringIntensity = Math.max(0, intensity - i * 0.15);
      const targetRingAlpha = ringIntensity * 0.35;
      ringMat.alpha = this.lerp(ringMat.alpha, targetRingAlpha, 5 * deltaTime);

      // Animate ring position - wave effect flowing back
      const waveOffset = Math.sin(pulseTime * 2 + i * 1.5) * 0.3 * intensity;
      ring.position.z = 2 + i * 1.2 + waveOffset;

      // Scale rings based on speed
      const ringScale = (1 + i * 0.3) * pulse * (0.8 + intensity * 0.4);
      ring.scaling = new Vector3(ringScale, ringScale, 1);
    }
  }

  /**
   * Creates a shockwave ring mesh for visual effect
   */
  private createShockwaveRing(): Mesh {
    // Create a much larger, more dramatic torus for the shockwave
    const ring = MeshBuilder.CreateTorus('shockwave', {
      diameter: 12,
      thickness: 0.8,
      tessellation: 48,
    }, this.scene);

    const material = new StandardMaterial('shockwaveMat', this.scene);
    material.diffuseColor = new Color3(0.9, 0.95, 1);
    material.emissiveColor = new Color3(0.7, 0.85, 1);
    material.specularColor = new Color3(1, 1, 1);
    material.alpha = 0.9;

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
    ring.scaling = new Vector3(2, 2, 2);
    ring.visibility = 1;

    this.shockwaveRings.push(ring);

    // Spawn a second ring slightly delayed for dramatic layered effect
    const ring2 = this.createShockwaveRing();
    ring2.position.copyFrom(this.physics.position);
    ring2.rotation.x = Math.PI / 2;
    ring2.rotation.y = this.yaw;
    ring2.scaling = new Vector3(1.5, 1.5, 1.5);
    ring2.visibility = 0.8;
    this.shockwaveRings.push(ring2);

    // Add strong camera shake for impact
    this.cameraController.addShake(2.5);
  }

  /**
   * Creates a destructive stop shockwave ring (larger, more dramatic)
   */
  private createStopShockwaveRing(): Mesh {
    const ring = MeshBuilder.CreateTorus('stopShockwave', {
      diameter: 18,
      thickness: 1.2,
      tessellation: 64,
    }, this.scene);

    const material = new StandardMaterial('stopShockwaveMat', this.scene);
    // Bright blue/white for dramatic effect
    material.diffuseColor = new Color3(0.9, 0.95, 1);
    material.emissiveColor = new Color3(0.7, 0.85, 1);
    material.specularColor = new Color3(1, 1, 1);
    material.alpha = 0.95;

    ring.material = material;
    ring.isPickable = false;
    ring.visibility = 0;

    return ring;
  }

  /**
   * Spawns a destructive stop shockwave when abruptly stopping from high speed
   */
  private spawnStopShockwave(previousSpeed: number): void {
    // Create multiple expanding rings for very dramatic effect
    for (let i = 0; i < 5; i++) {
      const ring = this.createStopShockwaveRing();
      ring.position.copyFrom(this.physics.position);
      ring.rotation.x = Math.PI / 2;
      ring.scaling = new Vector3(1.5 + i * 0.8, 1.5 + i * 0.8, 1.5 + i * 0.8);
      ring.visibility = 1 - i * 0.1;

      this.shockwaveRings.push(ring);
    }

    // Intense camera shake - bigger effect
    const shakeIntensity = Math.min(8, previousSpeed / 20);
    this.cameraController.addShake(shakeIntensity);

    // Trigger building damage in radius
    if (this.onBuildingDamage) {
      const force = previousSpeed / 50; // Damage force based on speed
      this.onBuildingDamage(this.physics.position.clone(), STOP_SHOCKWAVE_RADIUS, force);
    }
  }

  /**
   * Creates a distortion sphere for brake shockwave effect
   */
  private createDistortionSphere(): Mesh {
    const sphere = MeshBuilder.CreateSphere('distortionSphere', {
      diameter: 2,
      segments: 16,
    }, this.scene);

    const material = new StandardMaterial('distortionMat', this.scene);
    material.diffuseColor = new Color3(0.85, 0.92, 1);
    material.emissiveColor = new Color3(0.6, 0.75, 0.95);
    material.specularColor = new Color3(1, 1, 1);
    material.alpha = 0.15;  // Much more transparent
    material.backFaceCulling = false;

    sphere.material = material;
    sphere.isPickable = false;
    sphere.visibility = 0;

    return sphere;
  }

  /**
   * Triggers brake shockwave when using LT to hard stop at high speed
   * Called from FlightState when braking at supersonic speeds
   */
  public triggerBrakeShockwave(previousSpeed: number): void {
    // Create expanding distortion sphere - subtle flash effect
    const distortionSphere = this.createDistortionSphere();
    distortionSphere.position.copyFrom(this.physics.position);
    distortionSphere.scaling = new Vector3(1, 1, 1);
    distortionSphere.visibility = 0.3;  // Reduced initial visibility
    this.shockwaveRings.push(distortionSphere);

    // Create multiple concentric rings for visual impact
    for (let i = 0; i < 4; i++) {
      const ring = this.createStopShockwaveRing();
      ring.position.copyFrom(this.physics.position);
      ring.rotation.x = Math.PI / 2 + (Math.random() - 0.5) * 0.3;
      ring.rotation.y = Math.random() * Math.PI * 2;
      ring.scaling = new Vector3(0.5 + i * 0.3, 0.5 + i * 0.3, 0.5 + i * 0.3);
      ring.visibility = 1;
      this.shockwaveRings.push(ring);
    }

    // Strong camera shake and effect
    const shakeIntensity = Math.min(6, previousSpeed / 25);
    this.cameraController.addShake(shakeIntensity);
    this.cameraController.triggerFlightStopEffect(previousSpeed);

    // Trigger building damage
    if (this.onBuildingDamage) {
      const force = previousSpeed / 40;
      this.onBuildingDamage(this.physics.position.clone(), STOP_SHOCKWAVE_RADIUS * 1.2, force);
    }
  }

  /**
   * Updates shockwave rings and distortion spheres (expand and fade)
   */
  private updateShockwaves(deltaTime: number): void {
    for (let i = this.shockwaveRings.length - 1; i >= 0; i--) {
      const mesh = this.shockwaveRings[i];

      // Different expand/fade speeds for different effect types
      const isDistortionSphere = mesh.name.includes('distortion');
      const isStopShockwave = mesh.name.includes('stop');

      // Distortion sphere should fade VERY quickly to avoid big blue circle
      const expandSpeed = isDistortionSphere ? 25 : (isStopShockwave ? 60 : 45);
      const fadeSpeed = isDistortionSphere ? 8 : 2;

      // Expand the mesh
      mesh.scaling.x += expandSpeed * deltaTime;
      mesh.scaling.y += expandSpeed * deltaTime;
      mesh.scaling.z += expandSpeed * deltaTime;

      // Fade out
      mesh.visibility -= fadeSpeed * deltaTime;

      // Remove when invisible
      if (mesh.visibility <= 0) {
        mesh.dispose();
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

    // Check for building collision damage during flight
    this.checkBuildingCollision();

    // Update heat vision
    this.updateHeatVision(input, deltaTime);

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
    // Update root node position (for particles attached to rootNode)
    this.rootNode.position.copyFrom(this.physics.position);

    // Create rotation from euler angles
    const rotation = Quaternion.RotationYawPitchRoll(this.yaw, this.pitch, this.roll);
    this.rootNode.rotationQuaternion = rotation;

    // Update voxel character transform and cape physics
    this.voxelCharacter.setTransform(this.physics.position, this.yaw, this.pitch, this.roll);
    this.voxelCharacter.update(deltaTime, this.physics.velocity, this.isFlightMode, this.currentSpeed);
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

    // Update wind breaking effect
    this.updateWindBreakEffect(deltaTime);

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

  /**
   * Adds camera shake - can be called externally for effects like building destruction
   */
  public addCameraShake(intensity: number): void {
    this.cameraController.addShake(intensity);
  }

  /**
   * Sets lock-on target for camera tracking
   * Camera will look towards the target while still following player
   */
  public setLockOnTarget(target: Vector3 | null): void {
    this.cameraController.setLockOnTarget(target);
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
    // Update physics to use flight collision behavior
    this.physics.isFlying = isFlying;
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

  /**
   * Sets callback for building collision damage
   */
  public setOnBuildingCollision(callback: (buildingMesh: any, impactPosition: Vector3, speed: number) => void): void {
    this.onBuildingCollision = callback;
  }

  /**
   * Sets callback for heat vision building damage
   */
  public setOnHeatVisionDamage(callback: (building: any, position: Vector3, damage: number) => void): void {
    this.heatVision.setOnBuildingDamage(callback);
  }

  /**
   * Updates heat vision based on input
   * When active, left stick controls beam direction instead of movement
   */
  private updateHeatVision(input: InputState, deltaTime: number): void {
    // Activate/deactivate based on input
    if (input.heatVisionHeld) {
      if (!this.heatVision.isHeatVisionActive()) {
        this.heatVision.activate();
      }

      // Calculate eye position properly:
      // Head is at 2.0 units up, eyes are at about 1.5 voxels up on the head (VOXEL_SIZE = 0.45)
      // Plus need to account for character rotation when flying
      const headHeight = 2.0 + 0.45 * 1.5;  // Head base + eyes on head
      const eyeForward = 0.45 * 1.1;  // Eyes are slightly forward on head

      // Calculate eye position in world space accounting for character pitch
      const cosPitch = Math.cos(this.pitch);
      const sinPitch = Math.sin(this.pitch);
      const cosYaw = Math.cos(this.yaw);
      const sinYaw = Math.sin(this.yaw);

      // Transform the local eye offset by character rotation
      const eyeOffset = new Vector3(
        eyeForward * sinYaw * cosPitch,
        headHeight * cosPitch - eyeForward * sinPitch,
        eyeForward * cosYaw * cosPitch
      );

      const eyePosition = this.physics.position.add(eyeOffset);
      const lookDirection = this.getForwardDirection();

      // Left stick controls beam aiming when heat vision is active
      const aimX = input.moveX;  // Horizontal aim
      const aimY = input.moveY;  // Vertical aim (forward/back = up/down for beam)

      this.heatVision.update(deltaTime, eyePosition, lookDirection, this.yaw, this.pitch, aimX, aimY);
    } else {
      if (this.heatVision.isHeatVisionActive()) {
        this.heatVision.deactivate();
      }
    }
  }

  /**
   * Returns true if heat vision is currently active (for blocking movement input)
   */
  public isHeatVisionActive(): boolean {
    return this.heatVision.isHeatVisionActive();
  }

  /**
   * Checks for collision with buildings during flight and triggers damage
   */
  private checkBuildingCollision(): void {
    // Only check when flying at significant speed
    if (!this.isFlightMode || this.currentSpeed < 20) return;

    // Prevent rapid-fire collision triggers (shorter cooldown for responsiveness)
    const now = performance.now();
    if (now - this.lastBuildingCollisionTime < 150) return;

    const velocity = this.physics.velocity;
    if (velocity.length() < 3) return;

    // Get direction without modifying original velocity
    const direction = velocity.clone().normalize();

    // Simple forward raycast - fast and reliable
    const lookAhead = Math.max(4, this.currentSpeed * 0.1);

    const result = this.physicsManager.raycast(
      this.physics.position,
      direction,
      lookAhead
    );

    // Also cast rays slightly to the sides for wider detection
    let hitResult = result;
    if (!result.hit || result.distance > PLAYER_RADIUS * 4) {
      // Try side rays
      const right = Vector3.Cross(direction, Vector3.Up()).normalize();
      const leftRay = this.physicsManager.raycast(
        this.physics.position.add(right.scale(-PLAYER_RADIUS)),
        direction,
        lookAhead
      );
      const rightRay = this.physicsManager.raycast(
        this.physics.position.add(right.scale(PLAYER_RADIUS)),
        direction,
        lookAhead
      );

      // Use closest hit
      if (leftRay.hit && leftRay.distance < (hitResult.distance || Infinity)) {
        hitResult = leftRay;
      }
      if (rightRay.hit && rightRay.distance < (hitResult.distance || Infinity)) {
        hitResult = rightRay;
      }
    }

    // Trigger collision if we're close enough
    const hitThreshold = PLAYER_RADIUS * 4 + this.currentSpeed * 0.05;

    if (hitResult.hit && hitResult.mesh && hitResult.distance < hitThreshold) {
      // Check mesh name - buildings start with "building_"
      const meshName = hitResult.mesh.name;

      // Direct check without lowercase for speed
      const isBuilding = meshName.startsWith('building_');

      // Exclude non-damageable parts
      const isExcluded = meshName.includes('strip');

      if (isBuilding && !isExcluded) {
        // Trigger building collision damage
        if (this.onBuildingCollision) {
          this.onBuildingCollision(hitResult.mesh, hitResult.point, this.currentSpeed);
        }

        // Add camera shake on impact
        const shakeIntensity = Math.min(4, this.currentSpeed / 25);
        this.cameraController.addShake(shakeIntensity);

        // Set cooldown
        this.lastBuildingCollisionTime = now;
      }
    }
  }

  private lerp(a: number, b: number, t: number): number {
    return a + (b - a) * Math.min(1, Math.max(0, t));
  }
}
