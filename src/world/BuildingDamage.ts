/**
 * Building Damage System - Handles building destruction and debris
 */

import { Scene } from '@babylonjs/core/scene';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';

// Debris constants
const MAX_DEBRIS_PIECES = 50;
const DEBRIS_LIFETIME = 4; // seconds
const GRAVITY = -30;

/**
 * Debris piece data
 */
interface DebrisPiece {
  mesh: Mesh;
  velocity: Vector3;
  angularVelocity: Vector3;
  lifetime: number;
}

/**
 * Damaged building tracking
 */
interface DamagedBuilding {
  mesh: Mesh;
  originalPosition: Vector3;
  damageLevel: number;
  shakeOffset: Vector3;
  shakeTime: number;
}

/**
 * Building damage system
 */
export class BuildingDamage {
  private scene: Scene;
  private debris: DebrisPiece[] = [];
  private damagedBuildings: Map<Mesh, DamagedBuilding> = new Map();
  private debrisMaterial: StandardMaterial;
  private debrisMaterialDark: StandardMaterial;

  constructor(scene: Scene) {
    this.scene = scene;

    // Create debris materials
    this.debrisMaterial = new StandardMaterial('debrisMat', scene);
    this.debrisMaterial.diffuseColor = new Color3(0.5, 0.5, 0.55);
    this.debrisMaterial.specularColor = new Color3(0.1, 0.1, 0.1);
    this.debrisMaterial.freeze();

    this.debrisMaterialDark = new StandardMaterial('debrisMatDark', scene);
    this.debrisMaterialDark.diffuseColor = new Color3(0.35, 0.35, 0.4);
    this.debrisMaterialDark.specularColor = new Color3(0.1, 0.1, 0.1);
    this.debrisMaterialDark.freeze();
  }

  /**
   * Applies shockwave damage to buildings in radius
   */
  public applyShockwaveDamage(
    position: Vector3,
    radius: number,
    force: number,
    buildings: Mesh[]
  ): void {
    for (const building of buildings) {
      const buildingPos = building.position;
      const dx = buildingPos.x - position.x;
      const dy = buildingPos.y - position.y;
      const dz = buildingPos.z - position.z;
      const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);

      if (distance < radius) {
        // Calculate damage based on distance and force
        const damageMultiplier = 1 - (distance / radius);
        const damage = force * damageMultiplier;

        this.damageBuilding(building, position, damage);
      }
    }
  }

  /**
   * Applies damage to a single building
   */
  private damageBuilding(building: Mesh, impactPosition: Vector3, damage: number): void {
    // Get or create damage tracking
    let damageData = this.damagedBuildings.get(building);

    if (!damageData) {
      damageData = {
        mesh: building,
        originalPosition: building.position.clone(),
        damageLevel: 0,
        shakeOffset: Vector3.Zero(),
        shakeTime: 0,
      };
      this.damagedBuildings.set(building, damageData);
    }

    damageData.damageLevel += damage;
    damageData.shakeTime = Math.min(2, damageData.shakeTime + damage * 0.5);

    // Spawn debris chunks from the building
    const numDebris = Math.floor(damage * 3);
    this.spawnDebrisFromBuilding(building, impactPosition, numDebris, damage);

    // If building takes too much damage, it collapses
    if (damageData.damageLevel > 5) {
      this.collapseBuilding(building, damageData);
    }
  }

  /**
   * Spawns debris pieces from a damaged building
   */
  private spawnDebrisFromBuilding(
    building: Mesh,
    impactPosition: Vector3,
    count: number,
    force: number
  ): void {
    // Limit total debris for performance
    const actualCount = Math.min(count, MAX_DEBRIS_PIECES - this.debris.length);
    if (actualCount <= 0) return;

    const buildingBounds = building.getBoundingInfo().boundingBox;
    const buildingCenter = building.position;

    for (let i = 0; i < actualCount; i++) {
      // Create debris chunk
      const size = 0.5 + Math.random() * 2;
      const debris = MeshBuilder.CreateBox(
        `debris_${Date.now()}_${i}`,
        {
          width: size * (0.5 + Math.random()),
          height: size * (0.5 + Math.random()),
          depth: size * (0.5 + Math.random()),
        },
        this.scene
      );

      // Position debris at random point on building surface facing impact
      const spawnPos = new Vector3(
        buildingCenter.x + (Math.random() - 0.5) * (buildingBounds.maximumWorld.x - buildingBounds.minimumWorld.x) * 0.8,
        buildingCenter.y + (Math.random() - 0.5) * (buildingBounds.maximumWorld.y - buildingBounds.minimumWorld.y) * 0.6,
        buildingCenter.z + (Math.random() - 0.5) * (buildingBounds.maximumWorld.z - buildingBounds.minimumWorld.z) * 0.8
      );

      debris.position = spawnPos;
      debris.material = Math.random() > 0.5 ? this.debrisMaterial : this.debrisMaterialDark;
      debris.isPickable = false;

      // Calculate velocity - debris flies away from impact
      const dirFromImpact = spawnPos.subtract(impactPosition).normalize();
      const velocity = dirFromImpact.scale(force * 10 + Math.random() * 20);
      velocity.y += 5 + Math.random() * 15; // Add upward velocity

      // Random rotation
      debris.rotation = new Vector3(
        Math.random() * Math.PI * 2,
        Math.random() * Math.PI * 2,
        Math.random() * Math.PI * 2
      );

      const angularVelocity = new Vector3(
        (Math.random() - 0.5) * 10,
        (Math.random() - 0.5) * 10,
        (Math.random() - 0.5) * 10
      );

      this.debris.push({
        mesh: debris,
        velocity,
        angularVelocity,
        lifetime: DEBRIS_LIFETIME,
      });
    }
  }

  /**
   * Collapses a building that has taken too much damage
   */
  private collapseBuilding(building: Mesh, _damageData: DamagedBuilding): void {
    // Spawn a lot of debris
    const impactPos = building.position.clone();
    impactPos.y = 0;
    this.spawnDebrisFromBuilding(building, impactPos, 15, 3);

    // Scale down the building to simulate collapse
    // Note: This is a simplified collapse effect
    building.scaling.y *= 0.3;
    building.position.y = building.position.y * 0.3;

    // Remove from damage tracking
    this.damagedBuildings.delete(building);
  }

  /**
   * Updates debris physics and building shake effects
   */
  public update(deltaTime: number): void {
    // Update debris pieces
    for (let i = this.debris.length - 1; i >= 0; i--) {
      const piece = this.debris[i];

      // Apply gravity
      piece.velocity.y += GRAVITY * deltaTime;

      // Update position
      piece.mesh.position.addInPlace(piece.velocity.scale(deltaTime));

      // Update rotation
      piece.mesh.rotation.x += piece.angularVelocity.x * deltaTime;
      piece.mesh.rotation.y += piece.angularVelocity.y * deltaTime;
      piece.mesh.rotation.z += piece.angularVelocity.z * deltaTime;

      // Ground collision
      if (piece.mesh.position.y < 0.5) {
        piece.mesh.position.y = 0.5;
        piece.velocity.y *= -0.3; // Bounce
        piece.velocity.x *= 0.7;
        piece.velocity.z *= 0.7;
        piece.angularVelocity.scaleInPlace(0.5);
      }

      // Update lifetime
      piece.lifetime -= deltaTime;

      // Fade out near end of life
      if (piece.lifetime < 1) {
        piece.mesh.visibility = piece.lifetime;
      }

      // Remove dead debris
      if (piece.lifetime <= 0) {
        piece.mesh.dispose();
        this.debris.splice(i, 1);
      }
    }

    // Update building shake effects
    for (const [building, data] of this.damagedBuildings) {
      if (data.shakeTime > 0) {
        data.shakeTime -= deltaTime;

        // Calculate shake offset
        const shakeIntensity = data.shakeTime * 0.3;
        data.shakeOffset = new Vector3(
          (Math.random() - 0.5) * shakeIntensity,
          0,
          (Math.random() - 0.5) * shakeIntensity
        );

        // Apply shake to building position
        building.position = data.originalPosition.add(data.shakeOffset);

        // Reset to original when shake ends
        if (data.shakeTime <= 0) {
          building.position = data.originalPosition.clone();
        }
      }
    }
  }

  /**
   * Applies impact damage from player collision
   */
  public applyImpactDamage(building: Mesh, impactPosition: Vector3, speed: number): void {
    const damage = speed / 30;
    if (damage > 0.5) {
      this.damageBuilding(building, impactPosition, damage);
    }
  }

  /**
   * Cleans up all debris
   */
  public dispose(): void {
    for (const piece of this.debris) {
      piece.mesh.dispose();
    }
    this.debris = [];
    this.damagedBuildings.clear();
    this.debrisMaterial.dispose();
    this.debrisMaterialDark.dispose();
  }
}
