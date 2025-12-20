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

// Bird constants - more birds for a lively city
const NUM_BIRD_FLOCKS = 20;        // Many more flocks
const BIRD_SPAWN_RADIUS = 500;
const WING_FLAP_SPEED = 14;

// Bird types for variety
enum BirdType {
  Pigeon = 0,     // Small, low flying, gray
  Seagull = 1,    // Medium, white, mid-height
  Crow = 2,       // Medium, black, varied height
  Hawk = 3,       // Large, brown, high soaring
}

/**
 * Individual voxel bird
 */
interface VoxelBird {
  root: TransformNode;
  body: Mesh;
  leftWing: Mesh;
  rightWing: Mesh;
  wingPhase: number;
  scale: number;
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
  birdType: BirdType;
  preferredHeight: number;
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
   * Creates materials for birds - by type
   */
  private createBirdMaterials(): void {
    // Pigeon - gray/purple iridescent
    const pigeonMat = new StandardMaterial('birdMat_pigeon', this.scene);
    pigeonMat.diffuseColor = new Color3(0.4, 0.4, 0.45);
    pigeonMat.specularColor = new Color3(0.2, 0.2, 0.25);
    pigeonMat.freeze();
    this.birdMaterials.push(pigeonMat);

    // Seagull - white/gray
    const seagullMat = new StandardMaterial('birdMat_seagull', this.scene);
    seagullMat.diffuseColor = new Color3(0.9, 0.9, 0.85);
    seagullMat.specularColor = new Color3(0.1, 0.1, 0.1);
    seagullMat.freeze();
    this.birdMaterials.push(seagullMat);

    // Crow - black
    const crowMat = new StandardMaterial('birdMat_crow', this.scene);
    crowMat.diffuseColor = new Color3(0.1, 0.1, 0.12);
    crowMat.specularColor = new Color3(0.3, 0.3, 0.35);
    crowMat.freeze();
    this.birdMaterials.push(crowMat);

    // Hawk - brown
    const hawkMat = new StandardMaterial('birdMat_hawk', this.scene);
    hawkMat.diffuseColor = new Color3(0.45, 0.3, 0.2);
    hawkMat.specularColor = new Color3(0.1, 0.1, 0.1);
    hawkMat.freeze();
    this.birdMaterials.push(hawkMat);
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
   * Creates a single flock of birds with type-based behavior
   */
  private createFlock(): BirdFlock {
    // Randomly select bird type with weighted distribution
    const typeRoll = Math.random();
    let birdType: BirdType;
    let preferredHeight: number;
    let flockSize: number;
    let scale: number;

    if (typeRoll < 0.4) {
      // 40% pigeons - low flying, large flocks
      birdType = BirdType.Pigeon;
      preferredHeight = 30 + Math.random() * 50;
      flockSize = 10 + Math.floor(Math.random() * 8);
      scale = 0.8;
    } else if (typeRoll < 0.65) {
      // 25% seagulls - medium height
      birdType = BirdType.Seagull;
      preferredHeight = 80 + Math.random() * 100;
      flockSize = 5 + Math.floor(Math.random() * 5);
      scale = 1.2;
    } else if (typeRoll < 0.85) {
      // 20% crows - varied height
      birdType = BirdType.Crow;
      preferredHeight = 50 + Math.random() * 150;
      flockSize = 6 + Math.floor(Math.random() * 6);
      scale = 1.0;
    } else {
      // 15% hawks - high soaring, small groups
      birdType = BirdType.Hawk;
      preferredHeight = 150 + Math.random() * 150;
      flockSize = 1 + Math.floor(Math.random() * 3);
      scale = 1.8;
    }

    const centerPos = new Vector3(
      (Math.random() - 0.5) * BIRD_SPAWN_RADIUS * 2,
      preferredHeight,
      (Math.random() - 0.5) * BIRD_SPAWN_RADIUS * 2
    );

    const direction = new Vector3(
      Math.random() - 0.5,
      0,
      Math.random() - 0.5
    ).normalize();

    const birds: VoxelBird[] = [];
    const material = this.birdMaterials[birdType];

    for (let i = 0; i < flockSize; i++) {
      const bird = this.createBird(material, scale);

      // Offset within flock
      const spreadFactor = birdType === BirdType.Hawk ? 20 : 8;
      const offset = new Vector3(
        (Math.random() - 0.5) * spreadFactor,
        (Math.random() - 0.5) * spreadFactor * 0.5,
        (Math.random() - 0.5) * spreadFactor
      );
      bird.root.position = centerPos.add(offset);

      birds.push(bird);
    }

    // Speed varies by type
    const baseSpeed = birdType === BirdType.Hawk ? 25 :
                      birdType === BirdType.Seagull ? 20 :
                      birdType === BirdType.Crow ? 18 : 12;

    return {
      birds,
      centerPosition: centerPos,
      direction,
      targetDirection: direction.clone(),
      speed: baseSpeed * (0.8 + Math.random() * 0.4),
      turnTimer: 3 + Math.random() * 5,
      birdType,
      preferredHeight,
    };
  }

  /**
   * Creates a single voxel bird with scale
   */
  private createBird(material: StandardMaterial, scale: number = 1.0): VoxelBird {
    const root = new TransformNode('bird', this.scene);
    const s = scale;

    // Body - elongated cube
    const body = MeshBuilder.CreateBox('birdBody', {
      width: 0.3 * s,
      height: 0.25 * s,
      depth: 0.6 * s,
    }, this.scene);
    body.material = material;
    body.parent = root;
    body.isPickable = false;

    // Head - small cube
    const head = MeshBuilder.CreateBox('birdHead', {
      width: 0.2 * s,
      height: 0.2 * s,
      depth: 0.2 * s,
    }, this.scene);
    head.material = material;
    head.parent = body;
    head.position = new Vector3(0, 0.05 * s, 0.35 * s);
    head.isPickable = false;

    // Beak - tiny cube
    const beak = MeshBuilder.CreateBox('birdBeak', {
      width: 0.08 * s,
      height: 0.06 * s,
      depth: 0.15 * s,
    }, this.scene);
    const beakMat = new StandardMaterial('beakMat', this.scene);
    beakMat.diffuseColor = new Color3(0.8, 0.6, 0.2);
    beak.material = beakMat;
    beak.parent = head;
    beak.position = new Vector3(0, -0.02 * s, 0.15 * s);
    beak.isPickable = false;

    // Left wing - flat cube
    const leftWing = MeshBuilder.CreateBox('birdLeftWing', {
      width: 0.8 * s,
      height: 0.05 * s,
      depth: 0.4 * s,
    }, this.scene);
    leftWing.material = material;
    leftWing.parent = root;
    leftWing.position = new Vector3(-0.4 * s, 0, 0);
    leftWing.setPivotPoint(new Vector3(0.4 * s, 0, 0));
    leftWing.isPickable = false;

    // Right wing
    const rightWing = MeshBuilder.CreateBox('birdRightWing', {
      width: 0.8 * s,
      height: 0.05 * s,
      depth: 0.4 * s,
    }, this.scene);
    rightWing.material = material;
    rightWing.parent = root;
    rightWing.position = new Vector3(0.4 * s, 0, 0);
    rightWing.setPivotPoint(new Vector3(-0.4 * s, 0, 0));
    rightWing.isPickable = false;

    // Tail - small flat cube
    const tail = MeshBuilder.CreateBox('birdTail', {
      width: 0.15 * s,
      height: 0.04 * s,
      depth: 0.25 * s,
    }, this.scene);
    tail.material = material;
    tail.parent = body;
    tail.position = new Vector3(0, 0.05 * s, -0.35 * s);
    tail.rotation.x = -0.3;
    tail.isPickable = false;

    return {
      root,
      body,
      leftWing,
      rightWing,
      wingPhase: Math.random() * Math.PI * 2,
      scale,
    };
  }

  /**
   * Updates all birds
   */
  public update(deltaTime: number, playerPosition: Vector3): void {
    for (const flock of this.flocks) {
      // Update turn timer
      flock.turnTimer -= deltaTime;
      if (flock.turnTimer <= 0) {
        // Pick new random direction
        flock.targetDirection = new Vector3(
          Math.random() - 0.5,
          (Math.random() - 0.5) * 0.3,
          Math.random() - 0.5
        ).normalize();
        flock.turnTimer = 3 + Math.random() * 5;
      }

      // Smoothly turn towards target direction
      flock.direction = Vector3.Lerp(flock.direction, flock.targetDirection, deltaTime * 0.5);
      flock.direction.normalize();

      // Avoid player - flee if too close
      const toPlayer = playerPosition.subtract(flock.centerPosition);
      const playerDist = toPlayer.length();
      if (playerDist < 50) {
        // Flee from player
        const fleeDir = flock.centerPosition.subtract(playerPosition).normalize();
        flock.direction = Vector3.Lerp(flock.direction, fleeDir, deltaTime * 3);
        flock.direction.normalize();
      }

      // Keep birds at their preferred height range
      const minH = Math.max(20, flock.preferredHeight - 30);
      const maxH = flock.preferredHeight + 50;
      if (flock.centerPosition.y < minH) {
        flock.direction.y = Math.abs(flock.direction.y) + 0.3;
      } else if (flock.centerPosition.y > maxH) {
        flock.direction.y = -Math.abs(flock.direction.y) - 0.3;
      }
      flock.direction.normalize();

      // Move flock center
      flock.centerPosition.addInPlace(flock.direction.scale(flock.speed * deltaTime));

      // Respawn flock if too far from player
      const distFromPlayer = Vector3.Distance(flock.centerPosition, playerPosition);
      if (distFromPlayer > BIRD_SPAWN_RADIUS) {
        // Respawn ahead of player at flock's preferred height
        const angle = Math.random() * Math.PI * 2;
        flock.centerPosition = playerPosition.add(new Vector3(
          Math.cos(angle) * BIRD_SPAWN_RADIUS * 0.7,
          flock.preferredHeight + (Math.random() - 0.5) * 30,
          Math.sin(angle) * BIRD_SPAWN_RADIUS * 0.7
        ));
      }

      // Update each bird in flock
      for (let i = 0; i < flock.birds.length; i++) {
        const bird = flock.birds[i];

        // Calculate individual position with slight offset
        const offset = new Vector3(
          Math.sin(bird.wingPhase * 0.3 + i) * 3,
          Math.sin(bird.wingPhase * 0.2 + i * 0.5) * 2,
          Math.cos(bird.wingPhase * 0.25 + i) * 3
        );
        bird.root.position = flock.centerPosition.add(offset);

        // Face direction of travel
        bird.root.rotation.y = Math.atan2(flock.direction.x, flock.direction.z);
        bird.root.rotation.x = -flock.direction.y * 0.5;

        // Flap wings
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
