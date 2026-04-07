/**
 * Traffic System - Voxel vehicles driving along the street grid.
 *
 * Vehicles are built from a few boxes (voxel-style body + cabin + wheels).
 * They follow avenues (N-S) and cross streets (E-W) in the city grid.
 * Each vehicle is a small group of meshes parented to a root transform.
 */

import { Scene } from '@babylonjs/core/scene';
import { Vector3, Color3 } from '@babylonjs/core/Maths/math';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';

const MAX_VEHICLES = 40;
const VEHICLE_SPEED = 10;       // ~22 mph urban speed
const SPAWN_RADIUS = 300;
const DESPAWN_RADIUS = 400;
const SPAWN_INTERVAL = 0.5;

// Street grid constants (must match City.ts)
const AVENUE_WIDTH = 40;
const STREET_WIDTH = 24;
const BLOCK_WIDTH = 70;
const BLOCK_DEPTH_AVG = 160;

interface Vehicle {
  root: TransformNode;
  meshes: Mesh[];
  x: number;
  z: number;
  dirX: number;
  dirZ: number;
  speed: number;
  laneOffset: number;  // Offset within the street (left/right lane)
}

// Shared materials (created once)
let vehicleMaterials: StandardMaterial[] | null = null;
let wheelMaterial: StandardMaterial | null = null;
let windowMaterial: StandardMaterial | null = null;

function createVehicleMaterials(scene: Scene): void {
  if (vehicleMaterials) return;

  vehicleMaterials = [];
  const colors = [
    new Color3(0.75, 0.1, 0.1),   // Red
    new Color3(0.1, 0.15, 0.6),   // Blue
    new Color3(0.9, 0.9, 0.88),   // White
    new Color3(0.08, 0.08, 0.08), // Black
    new Color3(0.9, 0.8, 0.15),   // Yellow (taxi)
    new Color3(0.55, 0.55, 0.6),  // Silver
    new Color3(0.15, 0.4, 0.15),  // Green
    new Color3(0.5, 0.25, 0.1),   // Brown
  ];
  for (const c of colors) {
    const m = new StandardMaterial('vehMat', scene);
    m.diffuseColor = c;
    m.specularColor = new Color3(0.2, 0.2, 0.2);
    m.freeze();
    vehicleMaterials.push(m);
  }

  wheelMaterial = new StandardMaterial('wheelMat', scene);
  wheelMaterial.diffuseColor = new Color3(0.1, 0.1, 0.1);
  wheelMaterial.freeze();

  windowMaterial = new StandardMaterial('vehWindowMat', scene);
  windowMaterial.diffuseColor = new Color3(0.15, 0.2, 0.3);
  windowMaterial.specularColor = new Color3(0.4, 0.4, 0.5);
  windowMaterial.freeze();
}

/**
 * Build a voxel-style car from boxes.
 */
function buildCar(scene: Scene, colorIndex: number): { root: TransformNode; meshes: Mesh[] } {
  createVehicleMaterials(scene);
  const root = new TransformNode('vehicle', scene);
  const meshes: Mesh[] = [];
  const mat = vehicleMaterials![colorIndex % vehicleMaterials!.length];

  // Body (lower box)
  const body = MeshBuilder.CreateBox('vBody', { width: 2.2, height: 1.2, depth: 5 }, scene);
  body.position.y = 0.8;
  body.material = mat;
  body.parent = root;
  body.isPickable = false;
  meshes.push(body);

  // Cabin (upper box, shorter)
  const cabin = MeshBuilder.CreateBox('vCabin', { width: 2, height: 1, depth: 2.5 }, scene);
  cabin.position.set(0, 1.8, -0.3);
  cabin.material = windowMaterial!;
  cabin.parent = root;
  cabin.isPickable = false;
  meshes.push(cabin);

  // Wheels (4 small dark boxes)
  const wheelPositions = [
    [-1.1, 0.3, 1.5], [1.1, 0.3, 1.5],
    [-1.1, 0.3, -1.5], [1.1, 0.3, -1.5],
  ];
  for (const [wx, wy, wz] of wheelPositions) {
    const wheel = MeshBuilder.CreateBox('vWheel', { width: 0.4, height: 0.6, depth: 0.8 }, scene);
    wheel.position.set(wx, wy, wz);
    wheel.material = wheelMaterial!;
    wheel.parent = root;
    wheel.isPickable = false;
    meshes.push(wheel);
  }

  return { root, meshes };
}

/**
 * Build a voxel-style truck/van from boxes.
 */
function buildTruck(scene: Scene, colorIndex: number): { root: TransformNode; meshes: Mesh[] } {
  createVehicleMaterials(scene);
  const root = new TransformNode('truck', scene);
  const meshes: Mesh[] = [];
  const mat = vehicleMaterials![colorIndex % vehicleMaterials!.length];

  // Long body
  const body = MeshBuilder.CreateBox('tBody', { width: 2.5, height: 2.5, depth: 7 }, scene);
  body.position.set(0, 1.5, -0.5);
  body.material = mat;
  body.parent = root;
  body.isPickable = false;
  meshes.push(body);

  // Cab (front, shorter)
  const cab = MeshBuilder.CreateBox('tCab', { width: 2.4, height: 1.8, depth: 2.5 }, scene);
  cab.position.set(0, 1.2, 3);
  cab.material = windowMaterial!;
  cab.parent = root;
  cab.isPickable = false;
  meshes.push(cab);

  // Wheels
  const wheelPositions = [
    [-1.3, 0.4, 2.5], [1.3, 0.4, 2.5],
    [-1.3, 0.4, -2], [1.3, 0.4, -2],
  ];
  for (const [wx, wy, wz] of wheelPositions) {
    const wheel = MeshBuilder.CreateBox('tWheel', { width: 0.5, height: 0.8, depth: 1 }, scene);
    wheel.position.set(wx, wy, wz);
    wheel.material = wheelMaterial!;
    wheel.parent = root;
    wheel.isPickable = false;
    meshes.push(wheel);
  }

  return { root, meshes };
}

export class TrafficSystem {
  private scene: Scene;
  private vehicles: Vehicle[] = [];
  private spawnTimer = 0;

  constructor(scene: Scene) {
    this.scene = scene;
    createVehicleMaterials(scene);
  }

  public update(deltaTime: number, playerPos: Vector3): void {
    // Spawn
    this.spawnTimer += deltaTime;
    if (this.spawnTimer >= SPAWN_INTERVAL && this.vehicles.length < MAX_VEHICLES) {
      this.spawnTimer = 0;
      this.trySpawnVehicle(playerPos);
    }

    // Update positions
    for (let i = this.vehicles.length - 1; i >= 0; i--) {
      const v = this.vehicles[i];
      v.x += v.dirX * v.speed * deltaTime;
      v.z += v.dirZ * v.speed * deltaTime;

      // Update mesh position
      v.root.position.set(v.x + v.laneOffset * v.dirZ, 0, v.z - v.laneOffset * v.dirX);

      // Despawn if too far
      const dx = v.x - playerPos.x, dz = v.z - playerPos.z;
      if (dx * dx + dz * dz > DESPAWN_RADIUS * DESPAWN_RADIUS) {
        for (const m of v.meshes) m.dispose();
        v.root.dispose();
        this.vehicles.splice(i, 1);
      }
    }
  }

  private trySpawnVehicle(playerPos: Vector3): void {
    // Pick a random street near the player
    const minDist = 60;
    const angle = Math.random() * Math.PI * 2;
    const dist = minDist + Math.random() * (SPAWN_RADIUS - minDist);
    const rawX = playerPos.x + Math.cos(angle) * dist;
    const rawZ = playerPos.z + Math.sin(angle) * dist;

    // Snap to nearest street grid line
    // Avenues run along Z at regular X intervals
    // Streets run along X at regular Z intervals
    const avenueSpacing = BLOCK_WIDTH + AVENUE_WIDTH;
    const streetSpacing = BLOCK_DEPTH_AVG + STREET_WIDTH;

    const driveOnAvenue = Math.random() > 0.5;

    let x: number, z: number, dirX: number, dirZ: number;

    if (driveOnAvenue) {
      // Snap X to nearest avenue center
      x = Math.round(rawX / avenueSpacing) * avenueSpacing + AVENUE_WIDTH * 0.25;
      z = rawZ;
      dirX = 0;
      dirZ = Math.random() > 0.5 ? 1 : -1;
    } else {
      // Snap Z to nearest street center
      x = rawX;
      z = Math.round(rawZ / streetSpacing) * streetSpacing + STREET_WIDTH * 0.25;
      dirX = Math.random() > 0.5 ? 1 : -1;
      dirZ = 0;
    }

    // Lane offset (left or right side of street)
    const laneOffset = (Math.random() > 0.5 ? 1 : -1) * (3 + Math.random() * 3);

    // Build the vehicle
    const colorIndex = Math.floor(Math.random() * 8);
    const isTruck = Math.random() > 0.7; // 30% trucks
    const { root, meshes } = isTruck
      ? buildTruck(this.scene, colorIndex)
      : buildCar(this.scene, colorIndex);

    // Set rotation to face movement direction
    root.position.set(x + laneOffset * (dirZ !== 0 ? 1 : 0), 0, z - laneOffset * (dirX !== 0 ? 1 : 0));
    if (dirX !== 0) {
      root.rotation.y = dirX > 0 ? Math.PI / 2 : -Math.PI / 2;
    } else {
      root.rotation.y = dirZ > 0 ? 0 : Math.PI;
    }

    this.vehicles.push({
      root, meshes, x, z, dirX, dirZ,
      speed: VEHICLE_SPEED * (0.7 + Math.random() * 0.6),
      laneOffset,
    });
  }

  public dispose(): void {
    for (const v of this.vehicles) {
      for (const m of v.meshes) m.dispose();
      v.root.dispose();
    }
    this.vehicles = [];
  }
}
