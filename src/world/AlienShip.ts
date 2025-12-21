/**
 * Alien Ship - World Engine inspired gravity beam ship
 * A massive alien ship hovers over the city, shooting a gravity beam
 * that creates oscillating gravity effects on debris (like Man of Steel)
 */

import { Scene } from '@babylonjs/core/scene';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { ParticleSystem } from '@babylonjs/core/Particles/particleSystem';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { GlowLayer } from '@babylonjs/core/Layers/glowLayer';

// Ship constants
const SHIP_HEIGHT = 250;  // Height above ground
const SHIP_SIZE = 80;  // Diameter of ship
const BEAM_RADIUS = 35;  // Radius of the gravity beam effect zone
const BEAM_DAMAGE_RADIUS = 30;  // Buildings within this radius get damaged

// Gravity beam oscillation
const GRAVITY_CYCLE_TIME = 2.5;  // Seconds for one up/down cycle
const GRAVITY_STRENGTH = 45;  // Strength of oscillating gravity

/**
 * Gravity zone data - tracks area affected by beam
 */
export interface GravityZone {
  center: Vector3;
  radius: number;
  phase: number;  // Current phase of oscillation (0 to 2*PI)
  active: boolean;
}

/**
 * Alien Ship with gravity beam
 */
export class AlienShip {
  private scene: Scene;

  // Ship components
  private root: TransformNode;
  private hullMain!: Mesh;
  private hullRing!: Mesh;
  private hullCore!: Mesh;
  private engineGlows: Mesh[] = [];

  // Beam components
  private beamMesh!: Mesh;
  private beamCore!: Mesh;
  private beamMaterial!: StandardMaterial;
  private beamCoreMaterial!: StandardMaterial;
  private beamParticles!: ParticleSystem;
  private groundImpactParticles!: ParticleSystem;
  private risingDebrisParticles!: ParticleSystem;

  // Glow effect
  private glowLayer: GlowLayer;

  // State
  private shipPosition: Vector3;
  private beamPhase: number = 0;
  private time: number = 0;

  // Gravity zone (exported for BuildingDamage to use)
  public gravityZone: GravityZone;

  // Callbacks
  private onBuildingDamage: ((position: Vector3, radius: number, damage: number) => void) | null = null;

  constructor(scene: Scene, worldCenter: Vector3 = Vector3.Zero()) {
    this.scene = scene;

    // Position ship above world center
    this.shipPosition = new Vector3(worldCenter.x, SHIP_HEIGHT, worldCenter.z);

    // Initialize gravity zone
    this.gravityZone = {
      center: new Vector3(worldCenter.x, 0, worldCenter.z),
      radius: BEAM_RADIUS,
      phase: 0,
      active: true,
    };

    // Create root transform
    this.root = new TransformNode('alienShipRoot', scene);
    this.root.position = this.shipPosition;

    // Create glow layer for the ship
    this.glowLayer = new GlowLayer('alienGlow', scene);
    this.glowLayer.intensity = 1.5;

    // Build the ship
    this.createShipHull();
    this.createEngineGlows();
    this.createGravityBeam();
    this.createBeamParticles();

    console.log('[AlienShip] Created at position:', this.shipPosition);
  }

  /**
   * Creates the main ship hull - saucer/disc shaped alien vessel
   */
  private createShipHull(): void {
    // Main disc hull - flattened sphere
    this.hullMain = MeshBuilder.CreateSphere('alienHullMain', {
      diameter: SHIP_SIZE,
      segments: 24,
    }, this.scene);
    this.hullMain.scaling = new Vector3(1, 0.15, 1);  // Flatten into disc
    this.hullMain.parent = this.root;

    const hullMaterial = new StandardMaterial('alienHullMat', this.scene);
    hullMaterial.diffuseColor = new Color3(0.15, 0.15, 0.2);
    hullMaterial.specularColor = new Color3(0.4, 0.4, 0.5);
    hullMaterial.emissiveColor = new Color3(0.02, 0.02, 0.05);
    this.hullMain.material = hullMaterial;

    // Outer ring - darker metallic ring around the disc
    this.hullRing = MeshBuilder.CreateTorus('alienHullRing', {
      diameter: SHIP_SIZE * 0.95,
      thickness: SHIP_SIZE * 0.08,
      tessellation: 48,
    }, this.scene);
    this.hullRing.parent = this.root;

    const ringMaterial = new StandardMaterial('alienRingMat', this.scene);
    ringMaterial.diffuseColor = new Color3(0.1, 0.1, 0.12);
    ringMaterial.specularColor = new Color3(0.5, 0.5, 0.6);
    this.hullRing.material = ringMaterial;

    // Central core - glowing dome on bottom
    this.hullCore = MeshBuilder.CreateSphere('alienCore', {
      diameter: SHIP_SIZE * 0.35,
      segments: 16,
    }, this.scene);
    this.hullCore.scaling = new Vector3(1, 0.5, 1);
    this.hullCore.position.y = -SHIP_SIZE * 0.05;
    this.hullCore.parent = this.root;

    const coreMaterial = new StandardMaterial('alienCoreMat', this.scene);
    coreMaterial.diffuseColor = new Color3(0.2, 0.3, 0.8);
    coreMaterial.emissiveColor = new Color3(0.3, 0.4, 1.0);
    coreMaterial.specularColor = new Color3(1, 1, 1);
    coreMaterial.alpha = 0.9;
    this.hullCore.material = coreMaterial;

    // Add core to glow layer
    this.glowLayer.addIncludedOnlyMesh(this.hullCore);
  }

  /**
   * Creates glowing engine pods around the ship
   */
  private createEngineGlows(): void {
    const engineCount = 6;
    const engineRadius = SHIP_SIZE * 0.42;

    const engineMaterial = new StandardMaterial('engineGlowMat', this.scene);
    engineMaterial.diffuseColor = new Color3(0.5, 0.6, 1.0);
    engineMaterial.emissiveColor = new Color3(0.4, 0.5, 1.0);
    engineMaterial.alpha = 0.85;

    for (let i = 0; i < engineCount; i++) {
      const angle = (i / engineCount) * Math.PI * 2;
      const engine = MeshBuilder.CreateSphere(`engine_${i}`, {
        diameter: SHIP_SIZE * 0.08,
        segments: 8,
      }, this.scene);

      engine.position = new Vector3(
        Math.cos(angle) * engineRadius,
        -SHIP_SIZE * 0.02,
        Math.sin(angle) * engineRadius
      );
      engine.parent = this.root;
      engine.material = engineMaterial;

      this.glowLayer.addIncludedOnlyMesh(engine);
      this.engineGlows.push(engine);
    }
  }

  /**
   * Creates the massive gravity beam shooting down from the ship
   */
  private createGravityBeam(): void {
    const beamHeight = SHIP_HEIGHT + 20;  // Extend slightly into ground

    // Outer beam - translucent energy field
    this.beamMesh = MeshBuilder.CreateCylinder('gravityBeamOuter', {
      height: beamHeight,
      diameterTop: BEAM_RADIUS * 0.6,
      diameterBottom: BEAM_RADIUS * 2.2,  // Wider at ground
      tessellation: 32,
    }, this.scene);
    this.beamMesh.position = new Vector3(0, -beamHeight / 2, 0);
    this.beamMesh.parent = this.root;

    this.beamMaterial = new StandardMaterial('beamMat', this.scene);
    this.beamMaterial.diffuseColor = new Color3(0.3, 0.4, 0.9);
    this.beamMaterial.emissiveColor = new Color3(0.2, 0.3, 0.7);
    this.beamMaterial.alpha = 0.15;
    this.beamMaterial.backFaceCulling = false;
    this.beamMesh.material = this.beamMaterial;

    // Inner beam core - brighter energy
    this.beamCore = MeshBuilder.CreateCylinder('gravityBeamCore', {
      height: beamHeight,
      diameterTop: BEAM_RADIUS * 0.15,
      diameterBottom: BEAM_RADIUS * 0.8,
      tessellation: 16,
    }, this.scene);
    this.beamCore.position = new Vector3(0, -beamHeight / 2, 0);
    this.beamCore.parent = this.root;

    this.beamCoreMaterial = new StandardMaterial('beamCoreMat', this.scene);
    this.beamCoreMaterial.diffuseColor = new Color3(0.5, 0.6, 1.0);
    this.beamCoreMaterial.emissiveColor = new Color3(0.4, 0.5, 1.0);
    this.beamCoreMaterial.alpha = 0.4;
    this.beamCoreMaterial.backFaceCulling = false;
    this.beamCore.material = this.beamCoreMaterial;

    this.glowLayer.addIncludedOnlyMesh(this.beamCore);
  }

  /**
   * Creates particle effects for the beam
   */
  private createBeamParticles(): void {
    // Main beam particles - energy flowing down the beam
    this.beamParticles = new ParticleSystem('beamParticles', 500, this.scene);
    this.beamParticles.createCylinderEmitter(BEAM_RADIUS * 0.3, SHIP_HEIGHT * 0.9, 0, 0);

    this.beamParticles.color1 = new Color4(0.3, 0.5, 1.0, 0.8);
    this.beamParticles.color2 = new Color4(0.5, 0.7, 1.0, 0.6);
    this.beamParticles.colorDead = new Color4(0.2, 0.3, 0.8, 0);

    this.beamParticles.minSize = 2;
    this.beamParticles.maxSize = 5;

    this.beamParticles.minLifeTime = 1.5;
    this.beamParticles.maxLifeTime = 3;

    // Downward flow
    this.beamParticles.direction1 = new Vector3(-3, -40, -3);
    this.beamParticles.direction2 = new Vector3(3, -60, 3);

    this.beamParticles.minEmitPower = 15;
    this.beamParticles.maxEmitPower = 30;

    this.beamParticles.emitter = this.shipPosition.clone();
    this.beamParticles.emitRate = 80;
    this.beamParticles.blendMode = ParticleSystem.BLENDMODE_ADD;

    this.beamParticles.start();

    // Ground impact particles - energy dissipating at ground level
    this.groundImpactParticles = new ParticleSystem('groundImpact', 300, this.scene);
    this.groundImpactParticles.createCylinderEmitter(BEAM_RADIUS * 1.5, 3, 0, 0);

    this.groundImpactParticles.color1 = new Color4(0.4, 0.5, 1.0, 0.7);
    this.groundImpactParticles.color2 = new Color4(0.6, 0.7, 1.0, 0.5);
    this.groundImpactParticles.colorDead = new Color4(0.3, 0.4, 0.9, 0);

    this.groundImpactParticles.minSize = 3;
    this.groundImpactParticles.maxSize = 8;

    this.groundImpactParticles.minLifeTime = 0.5;
    this.groundImpactParticles.maxLifeTime = 1.5;

    // Spread outward
    this.groundImpactParticles.direction1 = new Vector3(-20, 5, -20);
    this.groundImpactParticles.direction2 = new Vector3(20, 15, 20);

    this.groundImpactParticles.minEmitPower = 8;
    this.groundImpactParticles.maxEmitPower = 20;

    this.groundImpactParticles.emitter = new Vector3(
      this.shipPosition.x,
      2,
      this.shipPosition.z
    );
    this.groundImpactParticles.emitRate = 60;
    this.groundImpactParticles.blendMode = ParticleSystem.BLENDMODE_ADD;

    this.groundImpactParticles.start();

    // Rising debris/dust particles - showing the oscillating gravity
    this.risingDebrisParticles = new ParticleSystem('risingDebris', 200, this.scene);
    this.risingDebrisParticles.createCylinderEmitter(BEAM_RADIUS * 1.2, 5, 0, 0);

    this.risingDebrisParticles.color1 = new Color4(0.5, 0.45, 0.4, 0.7);
    this.risingDebrisParticles.color2 = new Color4(0.4, 0.35, 0.3, 0.5);
    this.risingDebrisParticles.colorDead = new Color4(0.3, 0.25, 0.2, 0);

    this.risingDebrisParticles.minSize = 1;
    this.risingDebrisParticles.maxSize = 4;

    this.risingDebrisParticles.minLifeTime = 2;
    this.risingDebrisParticles.maxLifeTime = 4;

    // Initial direction - will be modulated in update
    this.risingDebrisParticles.direction1 = new Vector3(-5, 10, -5);
    this.risingDebrisParticles.direction2 = new Vector3(5, 30, 5);

    this.risingDebrisParticles.minEmitPower = 5;
    this.risingDebrisParticles.maxEmitPower = 15;

    this.risingDebrisParticles.emitter = new Vector3(
      this.shipPosition.x,
      5,
      this.shipPosition.z
    );
    this.risingDebrisParticles.emitRate = 40;
    this.risingDebrisParticles.blendMode = ParticleSystem.BLENDMODE_STANDARD;

    // Add gravity that oscillates
    this.risingDebrisParticles.gravity = new Vector3(0, -10, 0);

    this.risingDebrisParticles.start();
  }

  /**
   * Sets callback for building damage
   */
  public setOnBuildingDamage(callback: (position: Vector3, radius: number, damage: number) => void): void {
    this.onBuildingDamage = callback;
  }

  /**
   * Gets the gravity zone for external systems to use
   */
  public getGravityZone(): GravityZone {
    return this.gravityZone;
  }

  /**
   * Gets current oscillating gravity strength (-1 to 1, negative = pulling up)
   */
  public getOscillatingGravityFactor(): number {
    return Math.sin(this.beamPhase);
  }

  /**
   * Checks if a position is within the gravity beam zone
   */
  public isInGravityZone(position: Vector3): boolean {
    const dx = position.x - this.gravityZone.center.x;
    const dz = position.z - this.gravityZone.center.z;
    const horizontalDist = Math.sqrt(dx * dx + dz * dz);

    // Also check height - effect is stronger near ground, fades at ship height
    const inRadius = horizontalDist < this.gravityZone.radius;
    const inHeight = position.y < SHIP_HEIGHT - 20;

    return inRadius && inHeight;
  }

  /**
   * Gets the gravity modifier for a position in the beam
   * Returns oscillating gravity value that should replace normal gravity
   */
  public getGravityAtPosition(position: Vector3): number {
    if (!this.isInGravityZone(position)) {
      return -30;  // Normal gravity
    }

    const dx = position.x - this.gravityZone.center.x;
    const dz = position.z - this.gravityZone.center.z;
    const horizontalDist = Math.sqrt(dx * dx + dz * dz);

    // Strength falls off towards edges
    const distanceFactor = 1 - (horizontalDist / this.gravityZone.radius);

    // Height factor - stronger near ground
    const heightFactor = Math.max(0, 1 - (position.y / (SHIP_HEIGHT * 0.7)));

    // Combined oscillation
    const oscillation = Math.sin(this.beamPhase);

    // Return gravity that swings between pulling up and pushing down
    // oscillation of -1 = strong upward (positive gravity), +1 = strong downward (negative)
    const baseGravity = oscillation * GRAVITY_STRENGTH * distanceFactor * heightFactor;

    return baseGravity;
  }

  /**
   * Gets the ship position
   */
  public getPosition(): Vector3 {
    return this.shipPosition.clone();
  }

  /**
   * Gets the beam ground center position
   */
  public getBeamCenter(): Vector3 {
    return this.gravityZone.center.clone();
  }

  /**
   * Updates the alien ship and gravity beam effects
   */
  public update(deltaTime: number): void {
    this.time += deltaTime;

    // Update beam oscillation phase
    this.beamPhase += (deltaTime / GRAVITY_CYCLE_TIME) * Math.PI * 2;
    if (this.beamPhase > Math.PI * 2) {
      this.beamPhase -= Math.PI * 2;
    }
    this.gravityZone.phase = this.beamPhase;

    // Animate beam pulsing
    const beamPulse = 0.8 + Math.sin(this.time * 3) * 0.2;
    this.beamMaterial.alpha = 0.12 + beamPulse * 0.08;
    this.beamCoreMaterial.emissiveColor = new Color3(
      0.4 + beamPulse * 0.2,
      0.5 + beamPulse * 0.2,
      1.0
    );

    // Animate engine glows
    for (let i = 0; i < this.engineGlows.length; i++) {
      const engine = this.engineGlows[i];
      const pulse = 0.8 + Math.sin(this.time * 4 + i * 0.5) * 0.2;
      engine.scaling.setAll(pulse);
    }

    // Animate core glow
    const corePulse = 0.9 + Math.sin(this.time * 2) * 0.1;
    const coreMat = this.hullCore.material as StandardMaterial;
    coreMat.emissiveColor = new Color3(
      0.3 * corePulse,
      0.4 * corePulse,
      1.0 * corePulse
    );

    // Subtle ship rotation
    this.root.rotation.y += deltaTime * 0.05;

    // Update rising debris particles gravity based on oscillation
    const gravityOscillation = Math.sin(this.beamPhase);
    // When gravity oscillation is positive (pushing down phase), particles go down
    // When negative (pulling up phase), particles rise
    this.risingDebrisParticles.gravity = new Vector3(0, -gravityOscillation * 25, 0);

    // Also modulate particle direction
    if (gravityOscillation < 0) {
      // Pulling up - particles rise more
      this.risingDebrisParticles.direction1 = new Vector3(-5, 20, -5);
      this.risingDebrisParticles.direction2 = new Vector3(5, 50, 5);
      this.risingDebrisParticles.emitRate = 60;
    } else {
      // Pushing down - particles fall
      this.risingDebrisParticles.direction1 = new Vector3(-5, -10, -5);
      this.risingDebrisParticles.direction2 = new Vector3(5, 10, 5);
      this.risingDebrisParticles.emitRate = 30;
    }

    // Apply continuous damage to buildings in beam zone
    if (this.onBuildingDamage) {
      this.onBuildingDamage(
        this.gravityZone.center,
        BEAM_DAMAGE_RADIUS,
        50 * deltaTime  // Continuous damage
      );
    }
  }

  /**
   * Disposes all resources
   */
  public dispose(): void {
    this.hullMain.dispose();
    this.hullRing.dispose();
    this.hullCore.dispose();

    for (const engine of this.engineGlows) {
      engine.dispose();
    }

    this.beamMesh.dispose();
    this.beamCore.dispose();
    this.beamMaterial.dispose();
    this.beamCoreMaterial.dispose();

    this.beamParticles.dispose();
    this.groundImpactParticles.dispose();
    this.risingDebrisParticles.dispose();

    this.glowLayer.dispose();
    this.root.dispose();
  }
}
