/**
 * Traffic System - Cars moving along streets using thin instances.
 *
 * All cars are rendered as thin instances of a single mesh (ONE draw call).
 * Cars follow the street grid, moving in straight lines.
 * At night, cars get headlight glow.
 */

import { Scene } from '@babylonjs/core/scene';
import { Vector3, Matrix, Color3 } from '@babylonjs/core/Maths/math';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import '@babylonjs/core/Meshes/thinInstanceMesh';

const MAX_CARS = 80;
const CAR_SPEED = 12;         // ~27 mph, urban speed
const CAR_WIDTH = 2.5;
const CAR_HEIGHT = 1.8;
const CAR_LENGTH = 5;
const SPAWN_RADIUS = 400;     // Spawn cars within this radius of player
const DESPAWN_RADIUS = 500;   // Remove cars beyond this
const SPAWN_INTERVAL = 0.3;   // Seconds between spawn attempts

interface Car {
  x: number;
  z: number;
  dirX: number;   // Movement direction X (-1, 0, or 1)
  dirZ: number;   // Movement direction Z (-1, 0, or 1)
  speed: number;
  colorIndex: number;
}

export class TrafficSystem {
  private scene: Scene;
  private carMesh: Mesh;
  private cars: Car[] = [];
  private matrices: Float32Array;
  private spawnTimer = 0;
  private carColors: Color3[];

  // Reusable
  private static _tmpMatrix = Matrix.Identity();

  constructor(scene: Scene) {
    this.scene = scene;

    // Car colors
    this.carColors = [
      new Color3(0.8, 0.1, 0.1),   // Red
      new Color3(0.15, 0.15, 0.6), // Blue
      new Color3(0.9, 0.9, 0.9),   // White
      new Color3(0.1, 0.1, 0.1),   // Black
      new Color3(0.9, 0.8, 0.1),   // Yellow (taxi!)
      new Color3(0.6, 0.6, 0.65),  // Silver
    ];

    // Create car base mesh
    this.carMesh = MeshBuilder.CreateBox('carBase', {
      width: CAR_WIDTH, height: CAR_HEIGHT, depth: CAR_LENGTH
    }, scene);

    const carMat = new StandardMaterial('carMat', scene);
    carMat.diffuseColor = new Color3(0.5, 0.5, 0.5);
    carMat.specularColor = new Color3(0.3, 0.3, 0.3);
    carMat.freeze();
    this.carMesh.material = carMat;
    this.carMesh.isPickable = false;
    this.carMesh.isVisible = false; // Base mesh hidden, instances render

    this.matrices = new Float32Array(MAX_CARS * 16);
  }

  public update(deltaTime: number, playerPos: Vector3): void {
    // Spawn new cars periodically
    this.spawnTimer += deltaTime;
    if (this.spawnTimer >= SPAWN_INTERVAL && this.cars.length < MAX_CARS) {
      this.spawnTimer = 0;
      this.trySpawnCar(playerPos);
    }

    // Update car positions
    for (let i = this.cars.length - 1; i >= 0; i--) {
      const car = this.cars[i];

      // Move
      car.x += car.dirX * car.speed * deltaTime;
      car.z += car.dirZ * car.speed * deltaTime;

      // Despawn if too far from player
      const dx = car.x - playerPos.x;
      const dz = car.z - playerPos.z;
      if (dx * dx + dz * dz > DESPAWN_RADIUS * DESPAWN_RADIUS) {
        this.cars.splice(i, 1);
        continue;
      }
    }

    // Update instance matrices
    this.updateMatrices();
  }

  private trySpawnCar(playerPos: Vector3): void {
    // Spawn on a street near the player but not too close
    const minDist = 80;
    const angle = Math.random() * Math.PI * 2;
    const dist = minDist + Math.random() * (SPAWN_RADIUS - minDist);

    const x = playerPos.x + Math.cos(angle) * dist;
    const z = playerPos.z + Math.sin(angle) * dist;

    // Cars drive along X or Z axis (following the street grid)
    const driveAlongX = Math.random() > 0.5;
    const direction = Math.random() > 0.5 ? 1 : -1;

    this.cars.push({
      x,
      z,
      dirX: driveAlongX ? direction : 0,
      dirZ: driveAlongX ? 0 : direction,
      speed: CAR_SPEED * (0.8 + Math.random() * 0.4), // Slight speed variation
      colorIndex: Math.floor(Math.random() * this.carColors.length),
    });
  }

  private updateMatrices(): void {
    const count = this.cars.length;

    for (let i = 0; i < count; i++) {
      const car = this.cars[i];

      // Rotation: cars face their movement direction
      const rotY = car.dirX !== 0 ? (car.dirX > 0 ? 0 : Math.PI) : (car.dirZ > 0 ? Math.PI / 2 : -Math.PI / 2);

      Matrix.ComposeToRef(
        Vector3.One(),
        Vector3.Zero().toQuaternion(), // Will set rotation via RotationY
        new Vector3(car.x, CAR_HEIGHT / 2 + 0.15, car.z),
        TrafficSystem._tmpMatrix
      );

      // Manual rotation Y into the matrix
      const cos = Math.cos(rotY);
      const sin = Math.sin(rotY);
      const offset = i * 16;
      // Row-major 4x4 matrix with Y rotation
      this.matrices[offset + 0] = cos;
      this.matrices[offset + 1] = 0;
      this.matrices[offset + 2] = sin;
      this.matrices[offset + 3] = 0;
      this.matrices[offset + 4] = 0;
      this.matrices[offset + 5] = 1;
      this.matrices[offset + 6] = 0;
      this.matrices[offset + 7] = 0;
      this.matrices[offset + 8] = -sin;
      this.matrices[offset + 9] = 0;
      this.matrices[offset + 10] = cos;
      this.matrices[offset + 11] = 0;
      this.matrices[offset + 12] = car.x;
      this.matrices[offset + 13] = CAR_HEIGHT / 2 + 0.15;
      this.matrices[offset + 14] = car.z;
      this.matrices[offset + 15] = 1;
    }

    if (count > 0) {
      this.carMesh.thinInstanceSetBuffer(
        'matrix',
        this.matrices.subarray(0, count * 16),
        16,
        false
      );
      this.carMesh.isVisible = true;
    } else {
      this.carMesh.isVisible = false;
    }
  }

  public dispose(): void {
    this.carMesh.dispose();
  }
}
