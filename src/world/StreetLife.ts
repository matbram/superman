/**
 * StreetLife - Trees, crosswalks, hydrants, benches via thin instances.
 *
 * ALL street furniture rendered with thin instances of shared source meshes.
 * This means ~8 draw calls total for ALL street detail in the entire game,
 * regardless of how many chunks are loaded.
 *
 * Source meshes: tree trunk, tree canopy (3 colors), crosswalk, hydrant, bench
 * Each chunk adds instance matrices when generated, removes on unload.
 */

import { Scene } from '@babylonjs/core/scene';
import { Vector3, Matrix, Color3 } from '@babylonjs/core/Maths/math';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import '@babylonjs/core/Meshes/thinInstanceMesh';

// Street grid constants (must match City.ts)
const CHUNK_SIZE = 200;
const AVENUE_WIDTH = 40;
const STREET_WIDTH = 24;
const BLOCK_WIDTH = 70;

export class StreetLife {
  private scene: Scene;

  // Source meshes (shared globally, rendered via thin instances)
  private treeTrunk: Mesh;
  private treeCanopy: Mesh;
  private crosswalkStrip: Mesh;
  private hydrant: Mesh;

  // Instance matrices per chunk (for removal on unload)
  private chunkTrunkMatrices: Map<string, Float32Array> = new Map();
  private chunkCanopyMatrices: Map<string, Float32Array> = new Map();
  private chunkCrosswalkMatrices: Map<string, Float32Array> = new Map();
  private chunkHydrantMatrices: Map<string, Float32Array> = new Map();

  // Reusable
  private static _tmpMat = Matrix.Identity();

  constructor(scene: Scene) {
    this.scene = scene;

    // ── Tree Trunk ──
    this.treeTrunk = MeshBuilder.CreateBox('treeTrunkSrc', {
      width: 0.8, height: 4, depth: 0.8
    }, scene);
    const trunkMat = new StandardMaterial('trunkMat', scene);
    trunkMat.diffuseColor = new Color3(0.35, 0.22, 0.1);
    trunkMat.freeze();
    this.treeTrunk.material = trunkMat;
    this.treeTrunk.isPickable = false;
    this.treeTrunk.thinInstanceSetBuffer('matrix', new Float32Array(0), 16);

    // ── Tree Canopy ──
    this.treeCanopy = MeshBuilder.CreateBox('treeCanopySrc', {
      width: 4, height: 4, depth: 4
    }, scene);
    const canopyMat = new StandardMaterial('canopyMat', scene);
    canopyMat.diffuseColor = new Color3(0.15, 0.45, 0.12);
    canopyMat.freeze();
    this.treeCanopy.material = canopyMat;
    this.treeCanopy.isPickable = false;
    this.treeCanopy.thinInstanceSetBuffer('matrix', new Float32Array(0), 16);

    // ── Crosswalk Strip ──
    this.crosswalkStrip = MeshBuilder.CreateBox('crosswalkSrc', {
      width: 2, height: 0.08, depth: 12
    }, scene);
    const cwMat = new StandardMaterial('cwMat', scene);
    cwMat.diffuseColor = new Color3(0.95, 0.95, 0.9);
    cwMat.emissiveColor = new Color3(0.1, 0.1, 0.08);
    cwMat.freeze();
    this.crosswalkStrip.material = cwMat;
    this.crosswalkStrip.isPickable = false;
    this.crosswalkStrip.thinInstanceSetBuffer('matrix', new Float32Array(0), 16);

    // ── Fire Hydrant ──
    this.hydrant = MeshBuilder.CreateBox('hydrantSrc', {
      width: 0.8, height: 1.2, depth: 0.8
    }, scene);
    const hydMat = new StandardMaterial('hydMat', scene);
    hydMat.diffuseColor = new Color3(0.8, 0.15, 0.1);
    hydMat.freeze();
    this.hydrant.material = hydMat;
    this.hydrant.isPickable = false;
    this.hydrant.thinInstanceSetBuffer('matrix', new Float32Array(0), 16);
  }

  /**
   * Populate street furniture for a chunk. Called during chunk generation.
   */
  public populateChunk(chunkKey: string, worldX: number, worldZ: number, seed: number): void {
    const trunkMatrices: number[] = [];
    const canopyMatrices: number[] = [];
    const cwMatrices: number[] = [];
    const hydMatrices: number[] = [];

    // Simple seeded random for this chunk
    let s = seed;
    const rand = () => { s = (s * 1664525 + 1013904223) & 0x7fffffff; return s / 0x7fffffff; };

    const TREE_SPACING = 18;
    const HYDRANT_SPACING = 50;

    // Place trees and hydrants along avenue sidewalks
    const avenueSpacing = BLOCK_WIDTH + AVENUE_WIDTH;

    for (let ax = worldX + AVENUE_WIDTH * 0.5; ax < worldX + CHUNK_SIZE; ax += avenueSpacing) {
      // Trees on left sidewalk (5 units from block edge = middle of 8-unit sidewalk)
      for (let z = worldZ + 8; z < worldZ + CHUNK_SIZE - 8; z += TREE_SPACING + rand() * 5) {
        const tx = ax - AVENUE_WIDTH * 0.5 + 5;
        const treeH = 3 + rand() * 2;
        const canopySize = 0.8 + rand() * 0.4;

        // Trunk
        Matrix.TranslationToRef(tx, treeH * 0.5 + 0.15, z, StreetLife._tmpMat);
        trunkMatrices.push(...this.matrixToArray(StreetLife._tmpMat));

        // Canopy (scaled + translated)
        this.setScaleTranslation(canopyMatrices, canopySize, tx, treeH + 2 * canopySize, z);
      }

      // Trees on right sidewalk
      for (let z = worldZ + 12; z < worldZ + CHUNK_SIZE - 8; z += TREE_SPACING + rand() * 5) {
        const tx = ax + AVENUE_WIDTH * 0.5 - 5;
        const treeH = 3 + rand() * 2;
        const canopySize = 0.8 + rand() * 0.4;

        Matrix.TranslationToRef(tx, treeH * 0.5 + 0.15, z, StreetLife._tmpMat);
        trunkMatrices.push(...this.matrixToArray(StreetLife._tmpMat));
        this.setScaleTranslation(canopyMatrices, canopySize, tx, treeH + 2 * canopySize, z);
      }

      // Hydrants along avenue (left side only)
      for (let z = worldZ + 20; z < worldZ + CHUNK_SIZE - 20; z += HYDRANT_SPACING) {
        const hx = ax - AVENUE_WIDTH * 0.5 + 3; // On the sidewalk
        Matrix.TranslationToRef(hx, 0.75, z, StreetLife._tmpMat);
        hydMatrices.push(...this.matrixToArray(StreetLife._tmpMat));
      }
    }

    // Crosswalks at intersections (where avenues cross streets)
    const streetSpacing = 160 + STREET_WIDTH; // approx
    for (let ax = worldX + AVENUE_WIDTH * 0.5; ax < worldX + CHUNK_SIZE; ax += avenueSpacing) {
      for (let sz = worldZ; sz < worldZ + CHUNK_SIZE; sz += streetSpacing) {
        // Crosswalk strips across the avenue (6 strips per crosswalk)
        for (let strip = 0; strip < 6; strip++) {
          const cx = ax - 10 + strip * 4;
          const cz = sz + STREET_WIDTH * 0.5;
          Matrix.TranslationToRef(cx, 0.05, cz, StreetLife._tmpMat);
          cwMatrices.push(...this.matrixToArray(StreetLife._tmpMat));
        }
      }
    }

    // Store and rebuild buffers
    this.chunkTrunkMatrices.set(chunkKey, new Float32Array(trunkMatrices));
    this.chunkCanopyMatrices.set(chunkKey, new Float32Array(canopyMatrices));
    this.chunkCrosswalkMatrices.set(chunkKey, new Float32Array(cwMatrices));
    this.chunkHydrantMatrices.set(chunkKey, new Float32Array(hydMatrices));

    this.rebuildBuffers();
  }

  /**
   * Remove street furniture for an unloaded chunk.
   */
  public removeChunk(chunkKey: string): void {
    this.chunkTrunkMatrices.delete(chunkKey);
    this.chunkCanopyMatrices.delete(chunkKey);
    this.chunkCrosswalkMatrices.delete(chunkKey);
    this.chunkHydrantMatrices.delete(chunkKey);
    this.rebuildBuffers();
  }

  /**
   * Rebuild all thin instance buffers from active chunk data.
   */
  private rebuildBuffers(): void {
    this.rebuildMesh(this.treeTrunk, this.chunkTrunkMatrices);
    this.rebuildMesh(this.treeCanopy, this.chunkCanopyMatrices);
    this.rebuildMesh(this.crosswalkStrip, this.chunkCrosswalkMatrices);
    this.rebuildMesh(this.hydrant, this.chunkHydrantMatrices);
  }

  private rebuildMesh(mesh: Mesh, chunkData: Map<string, Float32Array>): void {
    let totalSize = 0;
    for (const arr of chunkData.values()) totalSize += arr.length;

    const buffer = new Float32Array(totalSize);
    let offset = 0;
    for (const arr of chunkData.values()) {
      buffer.set(arr, offset);
      offset += arr.length;
    }

    mesh.thinInstanceSetBuffer('matrix', buffer, 16, false);
  }

  private matrixToArray(m: Matrix): number[] {
    const arr: number[] = [];
    for (let i = 0; i < 16; i++) arr.push(m.m[i]);
    return arr;
  }

  private setScaleTranslation(target: number[], scale: number, x: number, y: number, z: number): void {
    // Identity matrix with scale and translation
    target.push(
      scale, 0, 0, 0,
      0, scale, 0, 0,
      0, 0, scale, 0,
      x, y, z, 1
    );
  }

  public dispose(): void {
    this.treeTrunk.dispose();
    this.treeCanopy.dispose();
    this.crosswalkStrip.dispose();
    this.hydrant.dispose();
  }
}
