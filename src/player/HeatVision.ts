/**
 * Heat Vision - Superman's laser eye beams
 * Shoots red beams from eyes that can damage/destroy buildings
 */

import { Scene } from '@babylonjs/core/scene';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { ParticleSystem } from '@babylonjs/core/Particles/particleSystem';
import { PhysicsManager } from '../physics/physics';

// Heat vision constants
const BEAM_LENGTH = 200;
const BEAM_WIDTH = 0.15;
const DAMAGE_PER_SECOND = 80;  // Damage dealt per second of continuous fire

/**
 * Heat Vision system
 */
export class HeatVision {
  private scene: Scene;
  private physicsManager: PhysicsManager;

  // Beam visuals
  private leftBeam: Mesh;
  private rightBeam: Mesh;
  private beamMaterial: StandardMaterial;

  // Impact effects
  private impactParticles: ParticleSystem | null = null;
  private impactPoint: Vector3 = Vector3.Zero();

  // State
  private isActive: boolean = false;
  private damageAccumulator: number = 0;

  // Callbacks
  private onBuildingDamage: ((building: AbstractMesh, position: Vector3, damage: number) => void) | null = null;

  constructor(scene: Scene, physicsManager: PhysicsManager) {
    this.scene = scene;
    this.physicsManager = physicsManager;

    // Create beam material - glowing red/orange
    this.beamMaterial = new StandardMaterial('heatBeamMat', scene);
    this.beamMaterial.diffuseColor = new Color3(1, 0.2, 0);
    this.beamMaterial.emissiveColor = new Color3(1, 0.3, 0.1);
    this.beamMaterial.specularColor = new Color3(1, 0.5, 0.2);
    this.beamMaterial.alpha = 0.9;

    // Create beam meshes (cylinders)
    this.leftBeam = MeshBuilder.CreateCylinder('leftHeatBeam', {
      height: BEAM_LENGTH,
      diameter: BEAM_WIDTH,
      tessellation: 8,
    }, scene);
    this.leftBeam.material = this.beamMaterial;
    this.leftBeam.isPickable = false;
    this.leftBeam.setEnabled(false);

    this.rightBeam = MeshBuilder.CreateCylinder('rightHeatBeam', {
      height: BEAM_LENGTH,
      diameter: BEAM_WIDTH,
      tessellation: 8,
    }, scene);
    this.rightBeam.material = this.beamMaterial;
    this.rightBeam.isPickable = false;
    this.rightBeam.setEnabled(false);

    // Create impact particles
    this.createImpactParticles();
  }

  /**
   * Creates particle system for beam impact
   */
  private createImpactParticles(): void {
    this.impactParticles = new ParticleSystem('heatImpact', 100, this.scene);

    // Fire/spark colors
    this.impactParticles.color1 = new Color4(1, 0.6, 0.1, 1);
    this.impactParticles.color2 = new Color4(1, 0.2, 0, 0.8);
    this.impactParticles.colorDead = new Color4(0.3, 0.1, 0, 0);

    this.impactParticles.minSize = 0.3;
    this.impactParticles.maxSize = 0.8;

    this.impactParticles.minLifeTime = 0.1;
    this.impactParticles.maxLifeTime = 0.3;

    this.impactParticles.emitRate = 0;
    this.impactParticles.blendMode = ParticleSystem.BLENDMODE_ADD;

    this.impactParticles.direction1 = new Vector3(-2, 2, -2);
    this.impactParticles.direction2 = new Vector3(2, 4, 2);
    this.impactParticles.minEmitPower = 3;
    this.impactParticles.maxEmitPower = 8;

    this.impactParticles.gravity = new Vector3(0, -5, 0);

    this.impactParticles.emitter = this.impactPoint;
    this.impactParticles.start();
  }

  /**
   * Sets callback for building damage
   */
  public setOnBuildingDamage(callback: (building: AbstractMesh, position: Vector3, damage: number) => void): void {
    this.onBuildingDamage = callback;
  }

  /**
   * Activates heat vision
   */
  public activate(): void {
    this.isActive = true;
    this.leftBeam.setEnabled(true);
    this.rightBeam.setEnabled(true);
    this.damageAccumulator = 0;
  }

  /**
   * Deactivates heat vision
   */
  public deactivate(): void {
    this.isActive = false;
    this.leftBeam.setEnabled(false);
    this.rightBeam.setEnabled(false);
    if (this.impactParticles) {
      this.impactParticles.emitRate = 0;
    }
    this.damageAccumulator = 0;
  }

  /**
   * Returns whether heat vision is active
   */
  public isHeatVisionActive(): boolean {
    return this.isActive;
  }

  /**
   * Updates heat vision - positions beams and checks for hits
   */
  public update(
    deltaTime: number,
    headPosition: Vector3,
    lookDirection: Vector3,
    yaw: number,
    _pitch: number
  ): void {
    if (!this.isActive) return;

    // Eye positions (offset from head center)
    const eyeOffset = 0.25;  // Distance between eyes
    const eyeForward = 0.4;  // How far forward eyes are

    // Calculate eye positions in world space
    const right = new Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
    const forward = lookDirection.clone();

    const leftEyePos = headPosition.add(right.scale(-eyeOffset)).add(forward.scale(eyeForward));
    const rightEyePos = headPosition.add(right.scale(eyeOffset)).add(forward.scale(eyeForward));

    // Raycast to find what we're hitting
    const rayResult = this.physicsManager.raycast(headPosition, forward, BEAM_LENGTH);

    let beamLength = BEAM_LENGTH;
    let hitPoint: Vector3 | null = null;

    if (rayResult.hit && rayResult.mesh) {
      beamLength = rayResult.distance;
      hitPoint = rayResult.point;

      // Check if we hit a building
      if (rayResult.mesh.name.startsWith('building_')) {
        // Accumulate damage
        this.damageAccumulator += DAMAGE_PER_SECOND * deltaTime;

        // Deal damage in chunks
        if (this.damageAccumulator >= 20) {
          if (this.onBuildingDamage) {
            this.onBuildingDamage(rayResult.mesh, hitPoint, this.damageAccumulator);
          }
          this.damageAccumulator = 0;
        }
      }
    }

    // Position and orient beams
    this.positionBeam(this.leftBeam, leftEyePos, forward, beamLength);
    this.positionBeam(this.rightBeam, rightEyePos, forward, beamLength);

    // Update impact particles
    if (this.impactParticles) {
      if (hitPoint) {
        this.impactPoint.copyFrom(hitPoint);
        this.impactParticles.emitter = this.impactPoint;
        this.impactParticles.emitRate = 80;
      } else {
        this.impactParticles.emitRate = 0;
      }
    }

    // Pulse beam intensity
    const pulse = 0.8 + Math.sin(performance.now() * 0.02) * 0.2;
    this.beamMaterial.emissiveColor = new Color3(pulse, 0.3 * pulse, 0.1 * pulse);
  }

  /**
   * Positions a beam mesh along a direction
   */
  private positionBeam(beam: Mesh, origin: Vector3, direction: Vector3, length: number): void {
    // Scale beam to correct length
    beam.scaling.y = length / BEAM_LENGTH;

    // Position beam so it starts at origin and extends along direction
    const beamCenter = origin.add(direction.scale(length / 2));
    beam.position.copyFrom(beamCenter);

    // Orient beam along direction
    // Cylinder default is Y-up, so we need to rotate to point along direction
    const up = Vector3.Up();
    const axis = Vector3.Cross(up, direction);

    if (axis.length() > 0.001) {
      axis.normalize();
      beam.rotationQuaternion = null;

      // Calculate rotation to point cylinder along direction
      beam.rotation.x = Math.atan2(
        -direction.y,
        Math.sqrt(direction.x * direction.x + direction.z * direction.z)
      ) + Math.PI / 2;
      beam.rotation.y = Math.atan2(direction.x, direction.z);
      beam.rotation.z = 0;
    }
  }

  /**
   * Disposes resources
   */
  public dispose(): void {
    this.leftBeam.dispose();
    this.rightBeam.dispose();
    this.beamMaterial.dispose();
    if (this.impactParticles) {
      this.impactParticles.dispose();
    }
  }
}
