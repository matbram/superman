/**
 * Voxel Character - Player character made of cubes with physics-based cape
 * Superman-style voxel humanoid with flowing cape
 */

import { Scene } from '@babylonjs/core/scene';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { ShadowGenerator } from '@babylonjs/core/Lights/Shadows/shadowGenerator';

// Character constants
const VOXEL_SIZE = 0.15;  // Size of each voxel cube

// Cape physics constants
const CAPE_SEGMENTS_X = 6;
const CAPE_SEGMENTS_Y = 8;
const CAPE_SEGMENT_SIZE = 0.25;
const CAPE_GRAVITY = -15;
const CAPE_WIND_RESISTANCE = 3;
const CAPE_STIFFNESS = 50;
const CAPE_DAMPING = 5;

/**
 * Cape segment with physics
 */
interface CapeSegment {
  mesh: Mesh;
  position: Vector3;
  velocity: Vector3;
  restPosition: Vector3;  // Position relative to attachment point
}

/**
 * Voxel character with cape
 */
export class VoxelCharacter {
  private scene: Scene;
  private root: TransformNode;
  private bodyParts: Mesh[] = [];
  private capeSegments: CapeSegment[][] = [];

  // Materials
  private skinMat: StandardMaterial;
  private suitMat: StandardMaterial;
  private bootMat: StandardMaterial;
  private hairMat: StandardMaterial;
  private capeMat: StandardMaterial;
  private beltMat: StandardMaterial;

  // Body part references for animation
  private leftArm: TransformNode;
  private rightArm: TransformNode;
  private leftLeg: TransformNode;
  private rightLeg: TransformNode;
  private head: TransformNode;

  constructor(scene: Scene, shadowGenerator?: ShadowGenerator) {
    this.scene = scene;
    this.root = new TransformNode('voxelCharacter', scene);

    // Create materials
    this.skinMat = this.createMaterial('skin', new Color3(0.9, 0.75, 0.6));
    this.suitMat = this.createMaterial('suit', new Color3(0.1, 0.2, 0.6));  // Blue suit
    this.bootMat = this.createMaterial('boot', new Color3(0.7, 0.1, 0.1));  // Red boots
    this.hairMat = this.createMaterial('hair', new Color3(0.1, 0.08, 0.05));  // Dark hair
    this.capeMat = this.createMaterial('cape', new Color3(0.8, 0.1, 0.1));  // Red cape
    this.beltMat = this.createMaterial('belt', new Color3(0.8, 0.7, 0.1));  // Yellow belt

    // Initialize transform nodes for limbs
    this.leftArm = new TransformNode('leftArm', scene);
    this.rightArm = new TransformNode('rightArm', scene);
    this.leftLeg = new TransformNode('leftLeg', scene);
    this.rightLeg = new TransformNode('rightLeg', scene);
    this.head = new TransformNode('head', scene);

    this.leftArm.parent = this.root;
    this.rightArm.parent = this.root;
    this.leftLeg.parent = this.root;
    this.rightLeg.parent = this.root;
    this.head.parent = this.root;

    // Position limb pivots
    this.leftArm.position = new Vector3(-0.35, 0.5, 0);
    this.rightArm.position = new Vector3(0.35, 0.5, 0);
    this.leftLeg.position = new Vector3(-0.12, -0.1, 0);
    this.rightLeg.position = new Vector3(0.12, -0.1, 0);
    this.head.position = new Vector3(0, 0.65, 0);

    // Build the character
    this.buildBody();
    this.buildHead();
    this.buildArms();
    this.buildLegs();
    this.buildCape();

    // Add shadows
    if (shadowGenerator) {
      for (const part of this.bodyParts) {
        shadowGenerator.addShadowCaster(part);
      }
    }
  }

  /**
   * Creates a material with the given color
   */
  private createMaterial(name: string, color: Color3): StandardMaterial {
    const mat = new StandardMaterial(`voxel_${name}`, this.scene);
    mat.diffuseColor = color;
    mat.specularColor = new Color3(0.2, 0.2, 0.2);
    return mat;
  }

  /**
   * Creates a voxel cube
   */
  private createVoxel(
    position: Vector3,
    material: StandardMaterial,
    parent: TransformNode,
    scale: Vector3 = new Vector3(1, 1, 1)
  ): Mesh {
    const voxel = MeshBuilder.CreateBox(`voxel_${Date.now()}_${Math.random()}`, {
      width: VOXEL_SIZE * scale.x,
      height: VOXEL_SIZE * scale.y,
      depth: VOXEL_SIZE * scale.z,
    }, this.scene);

    voxel.position = position;
    voxel.material = material;
    voxel.parent = parent;
    voxel.isPickable = false;

    this.bodyParts.push(voxel);
    return voxel;
  }

  /**
   * Builds the torso
   */
  private buildBody(): void {
    // Torso - 3x4x2 voxels
    for (let y = 0; y < 4; y++) {
      for (let x = -1; x <= 1; x++) {
        for (let z = 0; z <= 1; z++) {
          const pos = new Vector3(
            x * VOXEL_SIZE,
            y * VOXEL_SIZE + 0.1,
            z * VOXEL_SIZE - VOXEL_SIZE * 0.5
          );
          this.createVoxel(pos, this.suitMat, this.root);
        }
      }
    }

    // Belt
    for (let x = -1; x <= 1; x++) {
      for (let z = 0; z <= 1; z++) {
        const pos = new Vector3(
          x * VOXEL_SIZE,
          0.1,
          z * VOXEL_SIZE - VOXEL_SIZE * 0.5
        );
        this.createVoxel(pos, this.beltMat, this.root);
      }
    }

    // S logo on chest (simplified - just a yellow voxel)
    const logoPos = new Vector3(0, 0.4, VOXEL_SIZE * 0.6);
    this.createVoxel(logoPos, this.beltMat, this.root);
  }

  /**
   * Builds the head
   */
  private buildHead(): void {
    // Head - 2x2x2 voxels
    for (let y = 0; y < 2; y++) {
      for (let x = 0; x <= 1; x++) {
        for (let z = 0; z <= 1; z++) {
          const pos = new Vector3(
            (x - 0.5) * VOXEL_SIZE,
            y * VOXEL_SIZE,
            (z - 0.5) * VOXEL_SIZE
          );
          this.createVoxel(pos, this.skinMat, this.head);
        }
      }
    }

    // Hair on top
    for (let x = 0; x <= 1; x++) {
      for (let z = 0; z <= 1; z++) {
        const pos = new Vector3(
          (x - 0.5) * VOXEL_SIZE,
          2 * VOXEL_SIZE,
          (z - 0.5) * VOXEL_SIZE
        );
        this.createVoxel(pos, this.hairMat, this.head);
      }
    }

    // Hair curl on front
    const curlPos = new Vector3(0, 1.5 * VOXEL_SIZE, VOXEL_SIZE * 0.7);
    this.createVoxel(curlPos, this.hairMat, this.head);
  }

  /**
   * Builds the arms
   */
  private buildArms(): void {
    // Left arm - 5 voxels down
    for (let i = 0; i < 5; i++) {
      const pos = new Vector3(0, -i * VOXEL_SIZE, 0);
      const mat = i < 3 ? this.suitMat : this.skinMat;  // Sleeve then skin
      this.createVoxel(pos, mat, this.leftArm);
    }

    // Right arm
    for (let i = 0; i < 5; i++) {
      const pos = new Vector3(0, -i * VOXEL_SIZE, 0);
      const mat = i < 3 ? this.suitMat : this.skinMat;
      this.createVoxel(pos, mat, this.rightArm);
    }
  }

  /**
   * Builds the legs
   */
  private buildLegs(): void {
    // Left leg - 6 voxels down
    for (let i = 0; i < 6; i++) {
      const pos = new Vector3(0, -i * VOXEL_SIZE, 0);
      const mat = i < 4 ? this.suitMat : this.bootMat;  // Pants then boots
      this.createVoxel(pos, mat, this.leftLeg);
    }

    // Right leg
    for (let i = 0; i < 6; i++) {
      const pos = new Vector3(0, -i * VOXEL_SIZE, 0);
      const mat = i < 4 ? this.suitMat : this.bootMat;
      this.createVoxel(pos, mat, this.rightLeg);
    }
  }

  /**
   * Builds the cape with physics segments
   */
  private buildCape(): void {
    this.capeSegments = [];

    for (let x = 0; x < CAPE_SEGMENTS_X; x++) {
      const column: CapeSegment[] = [];

      for (let y = 0; y < CAPE_SEGMENTS_Y; y++) {
        const mesh = MeshBuilder.CreateBox(`cape_${x}_${y}`, {
          width: CAPE_SEGMENT_SIZE,
          height: CAPE_SEGMENT_SIZE * 0.1,
          depth: CAPE_SEGMENT_SIZE,
        }, this.scene);

        mesh.material = this.capeMat;
        mesh.isPickable = false;

        // Rest position relative to shoulder attachment
        const restPos = new Vector3(
          (x - CAPE_SEGMENTS_X / 2 + 0.5) * CAPE_SEGMENT_SIZE * 0.9,
          0.5 - y * CAPE_SEGMENT_SIZE * 0.3,
          -VOXEL_SIZE - y * CAPE_SEGMENT_SIZE * 0.8
        );

        const segment: CapeSegment = {
          mesh,
          position: this.root.position.add(restPos),
          velocity: Vector3.Zero(),
          restPosition: restPos,
        };

        column.push(segment);
        this.bodyParts.push(mesh);
      }

      this.capeSegments.push(column);
    }
  }

  /**
   * Gets the root transform node
   */
  public getRoot(): TransformNode {
    return this.root;
  }

  /**
   * Gets a mesh suitable for particle emitter attachment
   */
  public getEmitterMesh(): Mesh {
    return this.bodyParts[0];
  }

  /**
   * Updates the character position and orientation
   */
  public setTransform(position: Vector3, yaw: number, pitch: number, roll: number): void {
    this.root.position = position;
    this.root.rotation.y = yaw;
    this.root.rotation.x = pitch;
    this.root.rotation.z = roll;
  }

  /**
   * Updates cape physics and animations
   */
  public update(
    deltaTime: number,
    characterVelocity: Vector3,
    isFlying: boolean,
    speed: number
  ): void {
    // Animate limbs based on state
    if (isFlying) {
      // Flying pose - arms forward, legs back
      const flyPose = Math.min(1, speed / 50);

      this.leftArm.rotation.x = -Math.PI * 0.4 * flyPose;
      this.rightArm.rotation.x = -Math.PI * 0.4 * flyPose;
      this.leftArm.rotation.z = Math.PI * 0.1 * flyPose;
      this.rightArm.rotation.z = -Math.PI * 0.1 * flyPose;

      this.leftLeg.rotation.x = Math.PI * 0.2 * flyPose;
      this.rightLeg.rotation.x = Math.PI * 0.2 * flyPose;
    } else {
      // Standing/walking pose
      this.leftArm.rotation.x = 0;
      this.rightArm.rotation.x = 0;
      this.leftArm.rotation.z = 0;
      this.rightArm.rotation.z = 0;
      this.leftLeg.rotation.x = 0;
      this.rightLeg.rotation.x = 0;
    }

    // Update cape physics
    this.updateCapePhysics(deltaTime, characterVelocity, speed);
  }

  /**
   * Updates cape physics simulation
   */
  private updateCapePhysics(deltaTime: number, characterVelocity: Vector3, speed: number): void {
    const worldMatrix = this.root.getWorldMatrix();

    for (let x = 0; x < CAPE_SEGMENTS_X; x++) {
      for (let y = 0; y < CAPE_SEGMENTS_Y; y++) {
        const segment = this.capeSegments[x][y];

        if (y === 0) {
          // Top row is attached to character
          const attachPoint = Vector3.TransformCoordinates(
            new Vector3(
              (x - CAPE_SEGMENTS_X / 2 + 0.5) * CAPE_SEGMENT_SIZE * 0.9,
              0.55,
              -VOXEL_SIZE * 2
            ),
            worldMatrix
          );
          segment.position = attachPoint;
          segment.velocity = Vector3.Zero();
        } else {
          // Apply physics to free segments

          // Gravity
          segment.velocity.y += CAPE_GRAVITY * deltaTime;

          // Wind from movement (cape blows back when moving forward)
          const windForce = characterVelocity.scale(-CAPE_WIND_RESISTANCE * deltaTime);
          segment.velocity.addInPlace(windForce);

          // Extra wind at high speed
          if (speed > 30) {
            const turbulence = new Vector3(
              (Math.random() - 0.5) * speed * 0.1,
              (Math.random() - 0.5) * speed * 0.05,
              -speed * 0.3
            );
            segment.velocity.addInPlace(turbulence.scale(deltaTime));
          }

          // Spring force towards segment above
          const above = this.capeSegments[x][y - 1];
          const targetPos = above.position.add(new Vector3(0, -CAPE_SEGMENT_SIZE * 0.4, -CAPE_SEGMENT_SIZE * 0.5));
          const toTarget = targetPos.subtract(segment.position);
          const springForce = toTarget.scale(CAPE_STIFFNESS * deltaTime);
          segment.velocity.addInPlace(springForce);

          // Damping
          segment.velocity.scaleInPlace(1 - CAPE_DAMPING * deltaTime);

          // Limit velocity
          const maxVel = 50;
          if (segment.velocity.length() > maxVel) {
            segment.velocity = segment.velocity.normalize().scale(maxVel);
          }

          // Integrate position
          segment.position.addInPlace(segment.velocity.scale(deltaTime));

          // Constrain distance from segment above
          const maxDist = CAPE_SEGMENT_SIZE * 0.8;
          const diff = segment.position.subtract(above.position);
          if (diff.length() > maxDist) {
            segment.position = above.position.add(diff.normalize().scale(maxDist));
          }
        }

        // Update mesh position and rotation
        segment.mesh.position = segment.position;

        // Orient segment to face direction of travel
        if (y > 0) {
          const above = this.capeSegments[x][y - 1];
          const dir = segment.position.subtract(above.position);
          if (dir.length() > 0.01) {
            segment.mesh.rotation.x = Math.atan2(dir.y, -dir.z);
          }
        } else {
          segment.mesh.rotation = this.root.rotation.clone();
        }
      }
    }
  }

  /**
   * Disposes all resources
   */
  public dispose(): void {
    for (const part of this.bodyParts) {
      part.dispose();
    }
    this.bodyParts = [];

    this.root.dispose();
    this.skinMat.dispose();
    this.suitMat.dispose();
    this.bootMat.dispose();
    this.hairMat.dispose();
    this.capeMat.dispose();
    this.beltMat.dispose();
  }
}
