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
const BEAM_LENGTH = 300;
const BEAM_WIDTH = 1.5;  // Much thicker beams
const DAMAGE_PER_SECOND = 500;  // Massive destruction

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
   * Creates particle system for beam impact - massive explosion effects
   */
  private createImpactParticles(): void {
    this.impactParticles = new ParticleSystem('heatImpact', 500, this.scene);

    // Fire/spark colors - intense
    this.impactParticles.color1 = new Color4(1, 0.8, 0.2, 1);
    this.impactParticles.color2 = new Color4(1, 0.3, 0, 0.9);
    this.impactParticles.colorDead = new Color4(0.5, 0.1, 0, 0);

    this.impactParticles.minSize = 1.5;
    this.impactParticles.maxSize = 4.0;

    this.impactParticles.minLifeTime = 0.2;
    this.impactParticles.maxLifeTime = 0.6;

    this.impactParticles.emitRate = 0;
    this.impactParticles.blendMode = ParticleSystem.BLENDMODE_ADD;

    this.impactParticles.direction1 = new Vector3(-5, 5, -5);
    this.impactParticles.direction2 = new Vector3(5, 10, 5);
    this.impactParticles.minEmitPower = 10;
    this.impactParticles.maxEmitPower = 25;

    this.impactParticles.gravity = new Vector3(0, -8, 0);

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
   * @param aimOffsetX - Left stick X (-1 to 1) for horizontal aiming
   * @param aimOffsetY - Left stick Y (-1 to 1) for vertical aiming
   */
  public update(
    deltaTime: number,
    eyePosition: Vector3,
    _baseDirection: Vector3,
    yaw: number,
    pitch: number,
    aimOffsetX: number = 0,
    aimOffsetY: number = 0
  ): void {
    if (!this.isActive) return;

    // Calculate aim direction based on left stick input
    // Rotate the base direction by the aim offset
    const aimYaw = yaw + aimOffsetX * 1.2;  // About 70 degrees max turn
    const aimPitch = pitch + aimOffsetY * 0.8;  // About 45 degrees max up/down

    // Build aim direction from yaw and pitch
    const cosPitch = Math.cos(aimPitch);
    const aimDirection = new Vector3(
      Math.sin(aimYaw) * cosPitch,
      -Math.sin(aimPitch),
      Math.cos(aimYaw) * cosPitch
    ).normalize();

    // Eye positions (offset from eye center - eyes are about 0.2 units apart)
    const eyeOffset = 0.2;
    const right = new Vector3(Math.cos(aimYaw), 0, -Math.sin(aimYaw));

    const leftEyePos = eyePosition.add(right.scale(-eyeOffset));
    const rightEyePos = eyePosition.add(right.scale(eyeOffset));

    // Raycast to find what we're hitting
    const rayResult = this.physicsManager.raycast(eyePosition, aimDirection, BEAM_LENGTH);

    let beamLength = BEAM_LENGTH;
    let hitPoint: Vector3 | null = null;

    if (rayResult.hit && rayResult.mesh) {
      beamLength = rayResult.distance;
      hitPoint = rayResult.point;

      // Check if we hit a building or ground
      if (rayResult.mesh.name.startsWith('building_') || rayResult.mesh.name.startsWith('ground')) {
        // Accumulate damage - continuous stream
        this.damageAccumulator += DAMAGE_PER_SECOND * deltaTime;

        // Deal damage frequently for massive destruction
        if (this.damageAccumulator >= 30) {
          if (this.onBuildingDamage) {
            this.onBuildingDamage(rayResult.mesh, hitPoint, this.damageAccumulator);
          }
          this.damageAccumulator = 0;
        }
      }
    }

    // Position and orient beams from eyes
    this.positionBeam(this.leftBeam, leftEyePos, aimDirection, beamLength);
    this.positionBeam(this.rightBeam, rightEyePos, aimDirection, beamLength);

    // Update impact particles - massive when hitting
    if (this.impactParticles) {
      if (hitPoint) {
        this.impactPoint.copyFrom(hitPoint);
        this.impactParticles.emitter = this.impactPoint;
        this.impactParticles.emitRate = 300;  // Massive particle spray
      } else {
        this.impactParticles.emitRate = 0;
      }
    }

    // Pulse beam intensity - brighter
    const pulse = 0.9 + Math.sin(performance.now() * 0.03) * 0.1;
    this.beamMaterial.emissiveColor = new Color3(pulse, 0.4 * pulse, 0.1 * pulse);
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
