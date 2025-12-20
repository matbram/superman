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

// Character constants - man-sized proportions
const VOXEL_SIZE = 0.45;  // Large voxels for human-sized character

// Cape physics constants - fewer, larger segments for flowing cape
const CAPE_SEGMENTS_X = 4;   // Fewer horizontal segments
const CAPE_SEGMENTS_Y = 5;   // Fewer vertical segments
const CAPE_SEGMENT_SIZE = 0.8;  // Much larger cape pieces
const CAPE_GRAVITY = -12;
const CAPE_WIND_RESISTANCE = 4;
const CAPE_STIFFNESS = 40;
const CAPE_DAMPING = 4;

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

    // Position limb pivots - scaled for man-sized character
    this.leftArm.position = new Vector3(-1.0, 1.6, 0);
    this.rightArm.position = new Vector3(1.0, 1.6, 0);
    this.leftLeg.position = new Vector3(-0.35, -0.25, 0);
    this.rightLeg.position = new Vector3(0.35, -0.25, 0);
    this.head.position = new Vector3(0, 2.0, 0);

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
   * Builds the torso - wide, muscular Superman proportions
   */
  private buildBody(): void {
    // Upper torso / chest - very wide (6 voxels wide at shoulders), thick
    for (let y = 3; y < 5; y++) {
      for (let x = -2.5; x <= 2.5; x++) {
        for (let z = -0.5; z <= 1; z++) {
          const pos = new Vector3(
            x * VOXEL_SIZE,
            y * VOXEL_SIZE,
            z * VOXEL_SIZE
          );
          this.createVoxel(pos, this.suitMat, this.root);
        }
      }
    }

    // Pecs / chest muscles - extra layer in front
    for (let x = -1.5; x <= 1.5; x++) {
      const pos = new Vector3(x * VOXEL_SIZE, VOXEL_SIZE * 3.5, VOXEL_SIZE * 1.2);
      this.createVoxel(pos, this.suitMat, this.root);
    }

    // Mid torso - still wide (5 voxels), muscular core
    for (let y = 1; y < 3; y++) {
      for (let x = -2; x <= 2; x++) {
        for (let z = -0.5; z <= 1; z++) {
          const pos = new Vector3(
            x * VOXEL_SIZE,
            y * VOXEL_SIZE,
            z * VOXEL_SIZE
          );
          this.createVoxel(pos, this.suitMat, this.root);
        }
      }
    }

    // Waist/hips area - still substantial
    for (let x = -1.5; x <= 1.5; x++) {
      for (let z = -0.5; z <= 1; z++) {
        const pos = new Vector3(
          x * VOXEL_SIZE,
          0,
          z * VOXEL_SIZE
        );
        this.createVoxel(pos, this.suitMat, this.root);
      }
    }

    // Belt
    for (let x = -2; x <= 2; x++) {
      for (let z = 0; z <= 1; z++) {
        const pos = new Vector3(
          x * VOXEL_SIZE,
          VOXEL_SIZE * 0.8,
          z * VOXEL_SIZE
        );
        this.createVoxel(pos, this.beltMat, this.root);
      }
    }

    // S logo on chest (diamond shape - larger)
    this.createVoxel(new Vector3(0, VOXEL_SIZE * 3.8, VOXEL_SIZE * 1.4), this.beltMat, this.root);
    this.createVoxel(new Vector3(VOXEL_SIZE * 0.6, VOXEL_SIZE * 3.5, VOXEL_SIZE * 1.4), this.beltMat, this.root);
    this.createVoxel(new Vector3(-VOXEL_SIZE * 0.6, VOXEL_SIZE * 3.5, VOXEL_SIZE * 1.4), this.beltMat, this.root);
    this.createVoxel(new Vector3(0, VOXEL_SIZE * 3.2, VOXEL_SIZE * 1.4), this.beltMat, this.root);
    this.createVoxel(new Vector3(0, VOXEL_SIZE * 3.5, VOXEL_SIZE * 1.4), this.beltMat, this.root);
  }

  /**
   * Builds the head - larger, more detailed with eyes
   */
  private buildHead(): void {
    // Head - 3x3x3 voxels for more realistic size
    for (let y = 0; y < 3; y++) {
      for (let x = -1; x <= 1; x++) {
        for (let z = -1; z <= 1; z++) {
          // Skip corners for rounder shape
          if (Math.abs(x) === 1 && Math.abs(z) === 1 && (y === 0 || y === 2)) continue;

          const pos = new Vector3(
            x * VOXEL_SIZE,
            y * VOXEL_SIZE,
            z * VOXEL_SIZE
          );
          this.createVoxel(pos, this.skinMat, this.head);
        }
      }
    }

    // Neck
    this.createVoxel(new Vector3(0, -VOXEL_SIZE * 0.5, 0), this.skinMat, this.head);

    // Hair on top - full coverage
    for (let x = -1; x <= 1; x++) {
      for (let z = -1; z <= 1; z++) {
        const pos = new Vector3(
          x * VOXEL_SIZE,
          3 * VOXEL_SIZE,
          z * VOXEL_SIZE
        );
        this.createVoxel(pos, this.hairMat, this.head);
      }
    }

    // Hair sides
    for (let y = 2; y <= 3; y++) {
      this.createVoxel(new Vector3(-VOXEL_SIZE, y * VOXEL_SIZE, -VOXEL_SIZE), this.hairMat, this.head);
      this.createVoxel(new Vector3(VOXEL_SIZE, y * VOXEL_SIZE, -VOXEL_SIZE), this.hairMat, this.head);
    }

    // Iconic hair curl on forehead
    this.createVoxel(new Vector3(0, VOXEL_SIZE * 2.5, VOXEL_SIZE * 1.2), this.hairMat, this.head);
    this.createVoxel(new Vector3(VOXEL_SIZE * 0.3, VOXEL_SIZE * 2.8, VOXEL_SIZE * 1.1), this.hairMat, this.head);

    // Eyes (blue)
    const eyeMat = this.createMaterial('eyes', new Color3(0.2, 0.4, 0.8));
    this.createVoxel(new Vector3(-VOXEL_SIZE * 0.5, VOXEL_SIZE * 1.5, VOXEL_SIZE * 1.1), eyeMat, this.head, new Vector3(0.6, 0.4, 0.3));
    this.createVoxel(new Vector3(VOXEL_SIZE * 0.5, VOXEL_SIZE * 1.5, VOXEL_SIZE * 1.1), eyeMat, this.head, new Vector3(0.6, 0.4, 0.3));
  }

  /**
   * Builds the arms - thick, muscular arms
   */
  private buildArms(): void {
    // Left arm - muscular with thick biceps
    // Shoulder cap
    this.createVoxel(new Vector3(0, VOXEL_SIZE * 0.5, 0), this.suitMat, this.leftArm);
    this.createVoxel(new Vector3(0, VOXEL_SIZE * 0.5, VOXEL_SIZE * 0.5), this.suitMat, this.leftArm);

    // Upper arm / bicep (thick - 2x2 voxels)
    for (let i = 0; i < 3; i++) {
      this.createVoxel(new Vector3(0, -i * VOXEL_SIZE, 0), this.suitMat, this.leftArm);
      this.createVoxel(new Vector3(VOXEL_SIZE * 0.5, -i * VOXEL_SIZE, 0), this.suitMat, this.leftArm);
      this.createVoxel(new Vector3(0, -i * VOXEL_SIZE, VOXEL_SIZE * 0.5), this.suitMat, this.leftArm);
      this.createVoxel(new Vector3(VOXEL_SIZE * 0.5, -i * VOXEL_SIZE, VOXEL_SIZE * 0.5), this.suitMat, this.leftArm);
    }
    // Forearm (skin) - still thick
    for (let i = 3; i < 5; i++) {
      this.createVoxel(new Vector3(0, -i * VOXEL_SIZE, 0), this.skinMat, this.leftArm);
      this.createVoxel(new Vector3(VOXEL_SIZE * 0.4, -i * VOXEL_SIZE, 0), this.skinMat, this.leftArm);
      this.createVoxel(new Vector3(0, -i * VOXEL_SIZE, VOXEL_SIZE * 0.4), this.skinMat, this.leftArm);
    }
    // Hand / fist
    this.createVoxel(new Vector3(0, -5 * VOXEL_SIZE, 0), this.skinMat, this.leftArm);
    this.createVoxel(new Vector3(VOXEL_SIZE * 0.3, -5 * VOXEL_SIZE, 0), this.skinMat, this.leftArm);
    this.createVoxel(new Vector3(0, -5.5 * VOXEL_SIZE, 0), this.skinMat, this.leftArm);

    // Right arm - mirror of left
    this.createVoxel(new Vector3(0, VOXEL_SIZE * 0.5, 0), this.suitMat, this.rightArm);
    this.createVoxel(new Vector3(0, VOXEL_SIZE * 0.5, VOXEL_SIZE * 0.5), this.suitMat, this.rightArm);

    for (let i = 0; i < 3; i++) {
      this.createVoxel(new Vector3(0, -i * VOXEL_SIZE, 0), this.suitMat, this.rightArm);
      this.createVoxel(new Vector3(-VOXEL_SIZE * 0.5, -i * VOXEL_SIZE, 0), this.suitMat, this.rightArm);
      this.createVoxel(new Vector3(0, -i * VOXEL_SIZE, VOXEL_SIZE * 0.5), this.suitMat, this.rightArm);
      this.createVoxel(new Vector3(-VOXEL_SIZE * 0.5, -i * VOXEL_SIZE, VOXEL_SIZE * 0.5), this.suitMat, this.rightArm);
    }
    for (let i = 3; i < 5; i++) {
      this.createVoxel(new Vector3(0, -i * VOXEL_SIZE, 0), this.skinMat, this.rightArm);
      this.createVoxel(new Vector3(-VOXEL_SIZE * 0.4, -i * VOXEL_SIZE, 0), this.skinMat, this.rightArm);
      this.createVoxel(new Vector3(0, -i * VOXEL_SIZE, VOXEL_SIZE * 0.4), this.skinMat, this.rightArm);
    }
    this.createVoxel(new Vector3(0, -5 * VOXEL_SIZE, 0), this.skinMat, this.rightArm);
    this.createVoxel(new Vector3(-VOXEL_SIZE * 0.3, -5 * VOXEL_SIZE, 0), this.skinMat, this.rightArm);
    this.createVoxel(new Vector3(0, -5.5 * VOXEL_SIZE, 0), this.skinMat, this.rightArm);
  }

  /**
   * Builds the legs - thick, powerful legs
   */
  private buildLegs(): void {
    // Left leg - muscular thighs and calves
    // Upper thigh (very thick - 2x2)
    for (let i = 0; i < 3; i++) {
      this.createVoxel(new Vector3(0, -i * VOXEL_SIZE, 0), this.suitMat, this.leftLeg);
      this.createVoxel(new Vector3(VOXEL_SIZE * 0.5, -i * VOXEL_SIZE, 0), this.suitMat, this.leftLeg);
      this.createVoxel(new Vector3(0, -i * VOXEL_SIZE, VOXEL_SIZE * 0.5), this.suitMat, this.leftLeg);
      this.createVoxel(new Vector3(VOXEL_SIZE * 0.5, -i * VOXEL_SIZE, VOXEL_SIZE * 0.5), this.suitMat, this.leftLeg);
    }
    // Lower thigh / knee (still thick)
    for (let i = 3; i < 5; i++) {
      this.createVoxel(new Vector3(0, -i * VOXEL_SIZE, 0), this.suitMat, this.leftLeg);
      this.createVoxel(new Vector3(VOXEL_SIZE * 0.4, -i * VOXEL_SIZE, 0), this.suitMat, this.leftLeg);
      this.createVoxel(new Vector3(0, -i * VOXEL_SIZE, VOXEL_SIZE * 0.4), this.suitMat, this.leftLeg);
    }
    // Calf
    for (let i = 5; i < 7; i++) {
      this.createVoxel(new Vector3(0, -i * VOXEL_SIZE, 0), this.suitMat, this.leftLeg);
      this.createVoxel(new Vector3(VOXEL_SIZE * 0.3, -i * VOXEL_SIZE, 0), this.suitMat, this.leftLeg);
    }
    // Boot
    for (let i = 7; i < 9; i++) {
      this.createVoxel(new Vector3(0, -i * VOXEL_SIZE, 0), this.bootMat, this.leftLeg);
      this.createVoxel(new Vector3(VOXEL_SIZE * 0.3, -i * VOXEL_SIZE, 0), this.bootMat, this.leftLeg);
    }
    // Foot
    this.createVoxel(new Vector3(0, -9 * VOXEL_SIZE, VOXEL_SIZE * 0.5), this.bootMat, this.leftLeg);
    this.createVoxel(new Vector3(VOXEL_SIZE * 0.3, -9 * VOXEL_SIZE, VOXEL_SIZE * 0.5), this.bootMat, this.leftLeg);

    // Right leg - mirror
    for (let i = 0; i < 3; i++) {
      this.createVoxel(new Vector3(0, -i * VOXEL_SIZE, 0), this.suitMat, this.rightLeg);
      this.createVoxel(new Vector3(-VOXEL_SIZE * 0.5, -i * VOXEL_SIZE, 0), this.suitMat, this.rightLeg);
      this.createVoxel(new Vector3(0, -i * VOXEL_SIZE, VOXEL_SIZE * 0.5), this.suitMat, this.rightLeg);
      this.createVoxel(new Vector3(-VOXEL_SIZE * 0.5, -i * VOXEL_SIZE, VOXEL_SIZE * 0.5), this.suitMat, this.rightLeg);
    }
    for (let i = 3; i < 5; i++) {
      this.createVoxel(new Vector3(0, -i * VOXEL_SIZE, 0), this.suitMat, this.rightLeg);
      this.createVoxel(new Vector3(-VOXEL_SIZE * 0.4, -i * VOXEL_SIZE, 0), this.suitMat, this.rightLeg);
      this.createVoxel(new Vector3(0, -i * VOXEL_SIZE, VOXEL_SIZE * 0.4), this.suitMat, this.rightLeg);
    }
    for (let i = 5; i < 7; i++) {
      this.createVoxel(new Vector3(0, -i * VOXEL_SIZE, 0), this.suitMat, this.rightLeg);
      this.createVoxel(new Vector3(-VOXEL_SIZE * 0.3, -i * VOXEL_SIZE, 0), this.suitMat, this.rightLeg);
    }
    for (let i = 7; i < 9; i++) {
      this.createVoxel(new Vector3(0, -i * VOXEL_SIZE, 0), this.bootMat, this.rightLeg);
      this.createVoxel(new Vector3(-VOXEL_SIZE * 0.3, -i * VOXEL_SIZE, 0), this.bootMat, this.rightLeg);
    }
    this.createVoxel(new Vector3(0, -9 * VOXEL_SIZE, VOXEL_SIZE * 0.5), this.bootMat, this.rightLeg);
    this.createVoxel(new Vector3(-VOXEL_SIZE * 0.3, -9 * VOXEL_SIZE, VOXEL_SIZE * 0.5), this.bootMat, this.rightLeg);
  }

  /**
   * Builds the cape with physics segments - large flowing pieces
   */
  private buildCape(): void {
    this.capeSegments = [];

    for (let x = 0; x < CAPE_SEGMENTS_X; x++) {
      const column: CapeSegment[] = [];

      for (let y = 0; y < CAPE_SEGMENTS_Y; y++) {
        // Cape segments are large flat rectangles
        const mesh = MeshBuilder.CreateBox(`cape_${x}_${y}`, {
          width: CAPE_SEGMENT_SIZE * 0.95,
          height: CAPE_SEGMENT_SIZE * 0.08,  // Thin like cloth
          depth: CAPE_SEGMENT_SIZE * 0.9,
        }, this.scene);

        mesh.material = this.capeMat;
        mesh.isPickable = false;

        // Rest position - start well behind the character to avoid clipping
        const restPos = new Vector3(
          (x - CAPE_SEGMENTS_X / 2 + 0.5) * CAPE_SEGMENT_SIZE * 0.85,
          1.5 - y * CAPE_SEGMENT_SIZE * 0.5,
          -VOXEL_SIZE * 1.5 - y * CAPE_SEGMENT_SIZE * 0.7  // Further back
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
      // Superman flying pose - arms stretched forward, legs extended back together
      const flyPose = Math.min(1, speed / 40);

      // Arms forward (negative X rotation extends them forward when body is horizontal)
      // At high speed, arms are fully extended forward
      this.leftArm.rotation.x = -Math.PI * 0.5 * flyPose;  // Arms forward
      this.rightArm.rotation.x = -Math.PI * 0.5 * flyPose;
      // Arms closer together when flying fast
      this.leftArm.rotation.z = Math.PI * 0.15 * flyPose;   // Slight inward angle
      this.rightArm.rotation.z = -Math.PI * 0.15 * flyPose;

      // Legs extended back and together (positive X rotation extends them back)
      this.leftLeg.rotation.x = Math.PI * 0.45 * flyPose;  // Legs back
      this.rightLeg.rotation.x = Math.PI * 0.45 * flyPose;
      // Legs together
      this.leftLeg.rotation.z = -Math.PI * 0.05 * flyPose;  // Slight inward
      this.rightLeg.rotation.z = Math.PI * 0.05 * flyPose;
    } else {
      // Standing pose - reset all rotations
      this.leftArm.rotation.x = 0;
      this.rightArm.rotation.x = 0;
      this.leftArm.rotation.z = 0;
      this.rightArm.rotation.z = 0;
      this.leftLeg.rotation.x = 0;
      this.rightLeg.rotation.x = 0;
      this.leftLeg.rotation.z = 0;
      this.rightLeg.rotation.z = 0;
    }

    // Update cape physics
    this.updateCapePhysics(deltaTime, characterVelocity, speed);
  }

  /**
   * Updates cape physics simulation - keeps cape behind character
   */
  private updateCapePhysics(deltaTime: number, characterVelocity: Vector3, speed: number): void {
    const worldMatrix = this.root.getWorldMatrix();
    const charPos = this.root.position;

    for (let x = 0; x < CAPE_SEGMENTS_X; x++) {
      for (let y = 0; y < CAPE_SEGMENTS_Y; y++) {
        const segment = this.capeSegments[x][y];

        if (y === 0) {
          // Top row is attached to character's upper back
          const attachPoint = Vector3.TransformCoordinates(
            new Vector3(
              (x - CAPE_SEGMENTS_X / 2 + 0.5) * CAPE_SEGMENT_SIZE * 0.8,
              1.6,  // Shoulder height
              -VOXEL_SIZE * 2  // Behind the back
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

          // Extra wind at high speed - cape streams behind
          if (speed > 30) {
            const turbulence = new Vector3(
              (Math.random() - 0.5) * speed * 0.05,
              (Math.random() - 0.5) * speed * 0.02,
              -speed * 0.2  // Push cape back
            );
            segment.velocity.addInPlace(turbulence.scale(deltaTime));
          }

          // Spring force towards segment above - cape hangs down and back
          const above = this.capeSegments[x][y - 1];
          const targetPos = above.position.add(new Vector3(0, -CAPE_SEGMENT_SIZE * 0.6, -CAPE_SEGMENT_SIZE * 0.3));
          const toTarget = targetPos.subtract(segment.position);
          const springForce = toTarget.scale(CAPE_STIFFNESS * deltaTime);
          segment.velocity.addInPlace(springForce);

          // Damping
          segment.velocity.scaleInPlace(1 - CAPE_DAMPING * deltaTime);

          // Limit velocity
          const maxVel = 40;
          if (segment.velocity.length() > maxVel) {
            segment.velocity = segment.velocity.normalize().scale(maxVel);
          }

          // Integrate position
          segment.position.addInPlace(segment.velocity.scale(deltaTime));

          // Constrain distance from segment above
          const maxDist = CAPE_SEGMENT_SIZE * 0.7;
          const diff = segment.position.subtract(above.position);
          if (diff.length() > maxDist) {
            segment.position = above.position.add(diff.normalize().scale(maxDist));
          }

          // Keep cape behind character - prevent clipping through body
          const toChar = segment.position.subtract(charPos);
          const localZ = Vector3.TransformNormal(new Vector3(0, 0, 1), worldMatrix);
          const dotForward = Vector3.Dot(toChar, localZ);
          if (dotForward > -0.5) {
            // Cape is too far forward, push it back
            segment.position.subtractInPlace(localZ.scale(dotForward + 0.5));
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
