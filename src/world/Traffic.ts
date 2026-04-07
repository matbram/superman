/**
 * Traffic System - Voxel vehicles driving along the street grid.
 *
 * Vehicles are built from boxes (voxel-style body + cabin + wheels).
 * They snap to avenue/street center lines and drive in lanes.
 * Sized realistically relative to Superman (~4 units tall).
 */

import { Scene } from '@babylonjs/core/scene';
import { Vector3, Color3 } from '@babylonjs/core/Maths/math';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';

const MAX_VEHICLES = 35;
const VEHICLE_SPEED = 14;       // ~30 mph
const SPAWN_RADIUS = 300;
const DESPAWN_RADIUS = 400;
const SPAWN_INTERVAL = 0.6;

// Must match City.ts street grid
const CHUNK_SIZE = 200;
const AVENUE_WIDTH = 40;
const STREET_WIDTH = 24;
const BLOCK_WIDTH = 70;

interface Vehicle {
  root: TransformNode;
  meshes: Mesh[];
  x: number;
  z: number;
  dirX: number;
  dirZ: number;
  speed: number;
}

// Shared materials
let bodyMats: StandardMaterial[] | null = null;
let wheelMat: StandardMaterial | null = null;
let windowMat: StandardMaterial | null = null;

function ensureMaterials(scene: Scene): void {
  if (bodyMats) return;
  bodyMats = [];
  const colors = [
    new Color3(0.7, 0.08, 0.08),  // Red
    new Color3(0.1, 0.12, 0.55),  // Blue
    new Color3(0.88, 0.88, 0.85), // White
    new Color3(0.06, 0.06, 0.06), // Black
    new Color3(0.88, 0.78, 0.12), // Yellow taxi
    new Color3(0.5, 0.5, 0.55),   // Silver
    new Color3(0.12, 0.35, 0.12), // Green
    new Color3(0.45, 0.22, 0.08), // Brown
  ];
  for (const c of colors) {
    const m = new StandardMaterial('vMat', scene);
    m.diffuseColor = c; m.specularColor = new Color3(0.25, 0.25, 0.25);
    m.freeze(); bodyMats.push(m);
  }
  wheelMat = new StandardMaterial('wMat', scene);
  wheelMat.diffuseColor = new Color3(0.08, 0.08, 0.08); wheelMat.freeze();
  windowMat = new StandardMaterial('winMat', scene);
  windowMat.diffuseColor = new Color3(0.12, 0.18, 0.28);
  windowMat.specularColor = new Color3(0.4, 0.4, 0.5); windowMat.freeze();
}

function buildCar(scene: Scene, ci: number): { root: TransformNode; meshes: Mesh[] } {
  ensureMaterials(scene);
  const root = new TransformNode('car', scene);
  const meshes: Mesh[] = [];
  const mat = bodyMats![ci % bodyMats!.length];

  // Body: ~4.5m long, 2m wide, 1.2m tall = 10x4.4x2.7 units
  const body = MeshBuilder.CreateBox('cb', { width: 4.4, height: 2.5, depth: 10 }, scene);
  body.position.y = 1.8; body.material = mat; body.parent = root;
  body.isPickable = false; meshes.push(body);

  // Cabin/windows
  const cabin = MeshBuilder.CreateBox('cc', { width: 4, height: 2, depth: 5 }, scene);
  cabin.position.set(0, 3.6, -0.5); cabin.material = windowMat!; cabin.parent = root;
  cabin.isPickable = false; meshes.push(cabin);

  // 4 wheels
  for (const [wx, wz] of [[-2.2, 3], [2.2, 3], [-2.2, -3], [2.2, -3]]) {
    const w = MeshBuilder.CreateBox('cw', { width: 0.8, height: 1.2, depth: 1.6 }, scene);
    w.position.set(wx, 0.6, wz); w.material = wheelMat!; w.parent = root;
    w.isPickable = false; meshes.push(w);
  }
  return { root, meshes };
}

function buildTruck(scene: Scene, ci: number): { root: TransformNode; meshes: Mesh[] } {
  ensureMaterials(scene);
  const root = new TransformNode('truck', scene);
  const meshes: Mesh[] = [];
  const mat = bodyMats![ci % bodyMats!.length];

  // Cargo body: ~7m long, 2.5m wide, 3m tall
  const cargo = MeshBuilder.CreateBox('tb', { width: 5, height: 5, depth: 12 }, scene);
  cargo.position.set(0, 3, -1); cargo.material = mat; cargo.parent = root;
  cargo.isPickable = false; meshes.push(cargo);

  // Cab
  const cab = MeshBuilder.CreateBox('tc', { width: 4.8, height: 3.5, depth: 5 }, scene);
  cab.position.set(0, 2.2, 6); cab.material = windowMat!; cab.parent = root;
  cab.isPickable = false; meshes.push(cab);

  // 4 wheels (bigger)
  for (const [wx, wz] of [[-2.5, 5], [2.5, 5], [-2.5, -4], [2.5, -4]]) {
    const w = MeshBuilder.CreateBox('tw', { width: 1, height: 1.6, depth: 2 }, scene);
    w.position.set(wx, 0.8, wz); w.material = wheelMat!; w.parent = root;
    w.isPickable = false; meshes.push(w);
  }
  return { root, meshes };
}

export class TrafficSystem {
  private scene: Scene;
  private vehicles: Vehicle[] = [];
  private spawnTimer = 0;

  constructor(scene: Scene) {
    this.scene = scene;
    ensureMaterials(scene);
  }

  public update(deltaTime: number, playerPos: Vector3): void {
    this.spawnTimer += deltaTime;
    if (this.spawnTimer >= SPAWN_INTERVAL && this.vehicles.length < MAX_VEHICLES) {
      this.spawnTimer = 0;
      this.trySpawnVehicle(playerPos);
    }

    for (let i = this.vehicles.length - 1; i >= 0; i--) {
      const v = this.vehicles[i];
      v.x += v.dirX * v.speed * deltaTime;
      v.z += v.dirZ * v.speed * deltaTime;
      v.root.position.set(v.x, 0, v.z);

      const dx = v.x - playerPos.x, dz = v.z - playerPos.z;
      if (dx * dx + dz * dz > DESPAWN_RADIUS * DESPAWN_RADIUS) {
        for (const m of v.meshes) m.dispose();
        v.root.dispose();
        this.vehicles.splice(i, 1);
      }
    }
  }

  private trySpawnVehicle(playerPos: Vector3): void {
    const minDist = 80;
    const angle = Math.random() * Math.PI * 2;
    const dist = minDist + Math.random() * (SPAWN_RADIUS - minDist);
    const rawX = playerPos.x + Math.cos(angle) * dist;
    const rawZ = playerPos.z + Math.sin(angle) * dist;

    // Find the nearest avenue or cross street center line
    // Avenues are at X positions: chunkX * CHUNK_SIZE + AVENUE_WIDTH/2, then every (BLOCK_WIDTH + AVENUE_WIDTH)
    // Streets are at Z positions: chunkZ * CHUNK_SIZE + STREET_WIDTH/2, then every ~160 + STREET_WIDTH

    const driveOnAvenue = Math.random() > 0.5;
    let x: number, z: number, dirX: number, dirZ: number;

    if (driveOnAvenue) {
      // Snap to avenue center (avenues repeat every BLOCK_WIDTH + AVENUE_WIDTH = 110)
      const avenueSpacing = BLOCK_WIDTH + AVENUE_WIDTH;
      const chunkOriginX = Math.floor(rawX / CHUNK_SIZE) * CHUNK_SIZE;
      const localX = rawX - chunkOriginX;
      // Find nearest avenue center within the chunk
      const avenueIndex = Math.round((localX - AVENUE_WIDTH * 0.5) / avenueSpacing);
      x = chunkOriginX + AVENUE_WIDTH * 0.5 + avenueIndex * avenueSpacing;

      // Add lane offset (drive on one side of the avenue)
      const lane = (Math.random() > 0.5 ? 1 : -1) * (AVENUE_WIDTH * 0.2);
      x += lane;

      z = rawZ;
      dirX = 0;
      dirZ = Math.random() > 0.5 ? 1 : -1;
    } else {
      // Snap to cross street center
      const streetSpacing = 160 + STREET_WIDTH; // approximate average block depth + street
      const chunkOriginZ = Math.floor(rawZ / CHUNK_SIZE) * CHUNK_SIZE;
      const localZ = rawZ - chunkOriginZ;
      const streetIndex = Math.round((localZ - STREET_WIDTH * 0.5) / streetSpacing);
      z = chunkOriginZ + STREET_WIDTH * 0.5 + streetIndex * streetSpacing;

      const lane = (Math.random() > 0.5 ? 1 : -1) * (STREET_WIDTH * 0.2);
      z += lane;

      x = rawX;
      dirX = Math.random() > 0.5 ? 1 : -1;
      dirZ = 0;
    }

    const colorIndex = Math.floor(Math.random() * 8);
    const isTruck = Math.random() > 0.75;
    const { root, meshes } = isTruck ? buildTruck(this.scene, colorIndex) : buildCar(this.scene, colorIndex);

    // Face movement direction
    if (dirX !== 0) root.rotation.y = dirX > 0 ? Math.PI / 2 : -Math.PI / 2;
    else root.rotation.y = dirZ > 0 ? 0 : Math.PI;

    root.position.set(x, 0, z);

    this.vehicles.push({
      root, meshes, x, z, dirX, dirZ,
      speed: VEHICLE_SPEED * (0.7 + Math.random() * 0.6),
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
