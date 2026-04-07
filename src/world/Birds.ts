/**
 * Voxel Birds System
 * Ambient birds that fly around the city, made of small cubes
 */

import { Scene } from '@babylonjs/core/scene';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';

// Bird constants
const NUM_BIRD_FLOCKS = 8;
const BIRDS_PER_FLOCK = 5;
const BIRD_HEIGHT_MIN = 80;
const BIRD_HEIGHT_MAX = 200;
const BIRD_SPAWN_RADIUS = 400;
const BIRD_SPEED = 15;
const WING_FLAP_SPEED = 12;

/**
 * Individual voxel bird
 */
interface VoxelBird {
  root: TransformNode;
  body: Mesh;
  leftWing: Mesh;
  rightWing: Mesh;
  wingPhase: number;
}

/**
 * Flock of birds
 */
interface BirdFlock {
  birds: VoxelBird[];
  centerPosition: Vector3;
  direction: Vector3;
  targetDirection: Vector3;
  speed: number;
  turnTimer: number;
}

/**
 * Birds system - manages flocks of voxel birds
 */
export class Birds {
  private scene: Scene;
  private flocks: BirdFlock[] = [];
  private birdMaterials: StandardMaterial[] = [];

  constructor(scene: Scene) {
    this.scene = scene;
    this.createBirdMaterials();
    this.createFlocks();
  }

  /**
   * Creates materials for birds
   */
  private createBirdMaterials(): void {
    // Various bird colors
    const colors = [
      new Color3(0.2, 0.2, 0.25),   // Dark gray
      new Color3(0.15, 0.1, 0.1),   // Black
      new Color3(0.4, 0.35, 0.3),   // Brown
      new Color3(0.5, 0.5, 0.55),   // Light gray
      new Color3(0.3, 0.25, 0.2),   // Dark brown
    ];

    for (let i = 0; i < colors.length; i++) {
      const mat = new StandardMaterial(`birdMat_${i}`, this.scene);
      mat.diffuseColor = colors[i];
      mat.specularColor = new Color3(0.1, 0.1, 0.1);
      mat.freeze();
      this.birdMaterials.push(mat);
    }
  }

  /**
   * Creates all bird flocks
   */
  private createFlocks(): void {
    for (let i = 0; i < NUM_BIRD_FLOCKS; i++) {
      const flock = this.createFlock();
      this.flocks.push(flock);
    }
  }

  /**
   * Creates a single flock of birds
   */
  private createFlock(): BirdFlock {
    const centerPos = new Vector3(
      (Math.random() - 0.5) * BIRD_SPAWN_RADIUS * 2,
      BIRD_HEIGHT_MIN + Math.random() * (BIRD_HEIGHT_MAX - BIRD_HEIGHT_MIN),
      (Math.random() - 0.5) * BIRD_SPAWN_RADIUS * 2
    );

    const direction = new Vector3(
      Math.random() - 0.5,
      0,
      Math.random() - 0.5
    ).normalize();

    const birds: VoxelBird[] = [];
    const material = this.birdMaterials[Math.floor(Math.random() * this.birdMaterials.length)];

    for (let i = 0; i < BIRDS_PER_FLOCK; i++) {
      const bird = this.createBird(material);

      // Offset within flock
      const offset = new Vector3(
        (Math.random() - 0.5) * 10,
        (Math.random() - 0.5) * 5,
        (Math.random() - 0.5) * 10
      );
      bird.root.position = centerPos.add(offset);

      birds.push(bird);
    }

    return {
      birds,
      centerPosition: centerPos,
      direction,
      targetDirection: direction.clone(),
      speed: BIRD_SPEED * (0.8 + Math.random() * 0.4),
      turnTimer: 3 + Math.random() * 5,
    };
  }

  /**
   * Creates a single voxel bird
   */
  private createBird(material: StandardMaterial): VoxelBird {
    const root = new TransformNode('bird', this.scene);

    // Body - elongated cube
    const body = MeshBuilder.CreateBox('birdBody', {
      width: 0.3,
      height: 0.25,
      depth: 0.6,
    }, this.scene);
    body.material = material;
    body.parent = root;
    body.isPickable = false;

    // Head - small cube
    const head = MeshBuilder.CreateBox('birdHead', {
      width: 0.2,
      height: 0.2,
      depth: 0.2,
    }, this.scene);
    head.material = material;
    head.parent = body;
    head.position = new Vector3(0, 0.05, 0.35);
    head.isPickable = false;

    // Beak - tiny cube
    const beak = MeshBuilder.CreateBox('birdBeak', {
      width: 0.08,
      height: 0.06,
      depth: 0.15,
    }, this.scene);
    const beakMat = new StandardMaterial('beakMat', this.scene);
    beakMat.diffuseColor = new Color3(0.8, 0.6, 0.2);
    beak.material = beakMat;
    beak.parent = head;
    beak.position = new Vector3(0, -0.02, 0.15);
    beak.isPickable = false;

    // Left wing - flat cube
    const leftWing = MeshBuilder.CreateBox('birdLeftWing', {
      width: 0.8,
      height: 0.05,
      depth: 0.4,
    }, this.scene);
    leftWing.material = material;
    leftWing.parent = root;
    leftWing.position = new Vector3(-0.4, 0, 0);
    leftWing.setPivotPoint(new Vector3(0.4, 0, 0));
    leftWing.isPickable = false;

    // Right wing
    const rightWing = MeshBuilder.CreateBox('birdRightWing', {
      width: 0.8,
      height: 0.05,
      depth: 0.4,
    }, this.scene);
    rightWing.material = material;
    rightWing.parent = root;
    rightWing.position = new Vector3(0.4, 0, 0);
    rightWing.setPivotPoint(new Vector3(-0.4, 0, 0));
    rightWing.isPickable = false;

    // Tail - small flat cube
    const tail = MeshBuilder.CreateBox('birdTail', {
      width: 0.15,
      height: 0.04,
      depth: 0.25,
    }, this.scene);
    tail.material = material;
    tail.parent = body;
    tail.position = new Vector3(0, 0.05, -0.35);
    tail.rotation.x = -0.3;
    tail.isPickable = false;

    return {
      root,
      body,
      leftWing,
      rightWing,
      wingPhase: Math.random() * Math.PI * 2,
    };
  }

  // Reusable vectors to avoid per-frame allocations
  private _fleeDir = new Vector3();
  private static readonly BIRD_SPAWN_RADIUS_SQ = BIRD_SPAWN_RADIUS * BIRD_SPAWN_RADIUS;

  /**
   * Updates all birds
   */
  public update(deltaTime: number, playerPosition: Vector3): void {
    for (const flock of this.flocks) {
      // Update turn timer
      flock.turnTimer -= deltaTime;
      if (flock.turnTimer <= 0) {
        flock.targetDirection.set(
          Math.random() - 0.5,
          (Math.random() - 0.5) * 0.3,
          Math.random() - 0.5
        );
        flock.targetDirection.normalize();
        flock.turnTimer = 3 + Math.random() * 5;
      }

      // Smoothly turn towards target direction - Lerp in place
      const lerpFactor = deltaTime * 0.5;
      const invLerp = 1 - lerpFactor;
      flock.direction.x = flock.direction.x * invLerp + flock.targetDirection.x * lerpFactor;
      flock.direction.y = flock.direction.y * invLerp + flock.targetDirection.y * lerpFactor;
      flock.direction.z = flock.direction.z * invLerp + flock.targetDirection.z * lerpFactor;
      flock.direction.normalize();

      // Avoid player - use squared distance to skip sqrt
      const tpx = playerPosition.x - flock.centerPosition.x;
      const tpy = playerPosition.y - flock.centerPosition.y;
      const tpz = playerPosition.z - flock.centerPosition.z;
      const playerDistSq = tpx * tpx + tpy * tpy + tpz * tpz;

      if (playerDistSq < 2500) { // 50^2
        // Flee from player - reuse vector
        this._fleeDir.set(-tpx, -tpy, -tpz);
        this._fleeDir.normalize();
        const fleeLerp = deltaTime * 3;
        const fleeInv = 1 - fleeLerp;
        flock.direction.x = flock.direction.x * fleeInv + this._fleeDir.x * fleeLerp;
        flock.direction.y = flock.direction.y * fleeInv + this._fleeDir.y * fleeLerp;
        flock.direction.z = flock.direction.z * fleeInv + this._fleeDir.z * fleeLerp;
        flock.direction.normalize();
      }

      // Keep birds at reasonable height
      if (flock.centerPosition.y < BIRD_HEIGHT_MIN) {
        flock.direction.y = Math.abs(flock.direction.y) + 0.2;
      } else if (flock.centerPosition.y > BIRD_HEIGHT_MAX) {
        flock.direction.y = -Math.abs(flock.direction.y) - 0.2;
      }
      flock.direction.normalize();

      // Move flock center - inline to avoid scale() allocation
      const moveScale = flock.speed * deltaTime;
      flock.centerPosition.x += flock.direction.x * moveScale;
      flock.centerPosition.y += flock.direction.y * moveScale;
      flock.centerPosition.z += flock.direction.z * moveScale;

      // Respawn flock if too far from player - use squared distance
      const dfx = flock.centerPosition.x - playerPosition.x;
      const dfy = flock.centerPosition.y - playerPosition.y;
      const dfz = flock.centerPosition.z - playerPosition.z;
      if (dfx * dfx + dfy * dfy + dfz * dfz > Birds.BIRD_SPAWN_RADIUS_SQ) {
        const angle = Math.random() * Math.PI * 2;
        flock.centerPosition.x = playerPosition.x + Math.cos(angle) * BIRD_SPAWN_RADIUS * 0.7;
        flock.centerPosition.y = BIRD_HEIGHT_MIN + Math.random() * (BIRD_HEIGHT_MAX - BIRD_HEIGHT_MIN);
        flock.centerPosition.z = playerPosition.z + Math.sin(angle) * BIRD_SPAWN_RADIUS * 0.7;
      }

      // Precompute facing direction once per flock
      const facingY = Math.atan2(flock.direction.x, flock.direction.z);
      const facingX = -flock.direction.y * 0.5;

      // Update each bird in flock - set position components directly
      for (let i = 0; i < flock.birds.length; i++) {
        const bird = flock.birds[i];

        bird.root.position.x = flock.centerPosition.x + Math.sin(bird.wingPhase * 0.3 + i) * 3;
        bird.root.position.y = flock.centerPosition.y + Math.sin(bird.wingPhase * 0.2 + i * 0.5) * 2;
        bird.root.position.z = flock.centerPosition.z + Math.cos(bird.wingPhase * 0.25 + i) * 3;

        bird.root.rotation.y = facingY;
        bird.root.rotation.x = facingX;

        bird.wingPhase += WING_FLAP_SPEED * deltaTime;
        const flapAngle = Math.sin(bird.wingPhase) * 0.6;
        bird.leftWing.rotation.z = flapAngle;
        bird.rightWing.rotation.z = -flapAngle;
      }
    }
  }

  /**
   * Disposes all bird resources
   */
  public dispose(): void {
    for (const flock of this.flocks) {
      for (const bird of flock.birds) {
        bird.root.dispose();
      }
    }
    this.flocks = [];

    for (const mat of this.birdMaterials) {
      mat.dispose();
    }
  }
}
